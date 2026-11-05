"""Shared helpers for driving a Manifest V3 extension in a real Chrome.

Requirements: Python 3.9+, `pip install playwright` (only the Python driver is used; it connects to the Chrome you
already have, so `playwright install` is not needed), and Google Chrome. Set CHROME_PATH to use another binary.

How it works
- Chrome is started with a throw-away profile and a remote-debugging port. Chrome 137+ ignores --load-extension for
  branded builds, so the extension is loaded through the DevTools protocol (Extensions.loadUnpacked), which needs
  --enable-unsafe-extension-debugging.
- The extension is loaded from a temporary COPY whose manifest gets host_permissions for all sites. A real popup only
  gets access to the active tab after a toolbar click (activeTab), which automation cannot perform. The copy is for
  tests only; the shipped manifest is never modified.
- The popup page is opened as an ordinary tab. chrome.tabs.query is overridden so the popup believes the tab under
  test is the active one, which is what it sees when opened from the toolbar. The override can also fake an incognito
  tab or make storage writes fail, because a real incognito window cannot be opened by automation.
"""
import contextlib
import functools
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import sync_playwright

REPO = Path(__file__).resolve().parents[1]


def find_chrome():
    candidates = [os.environ.get("CHROME_PATH", "")]
    if sys.platform.startswith("win"):
        for root in (os.environ.get("PROGRAMFILES"), os.environ.get("PROGRAMFILES(X86)"), os.environ.get("LOCALAPPDATA")):
            if root:
                candidates.append(str(Path(root) / "Google" / "Chrome" / "Application" / "chrome.exe"))
    elif sys.platform == "darwin":
        candidates.append("/Applications/Google Chrome.app/Contents/MacOS/Google Chrome")
    else:
        candidates += [shutil.which(n) or "" for n in ("google-chrome", "google-chrome-stable", "chromium", "chromium-browser")]
    for c in candidates:
        if c and Path(c).exists():
            return c
    raise SystemExit("Chrome not found. Install Google Chrome or set CHROME_PATH.")


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


class Site:
    """A tiny local web server whose pages can be rewritten between audits."""

    def __init__(self, pages):
        self.dir = tempfile.mkdtemp(prefix="ext-test-site-")
        for name, html in pages.items():
            self.set(name, html)

        class Quiet(http.server.SimpleHTTPRequestHandler):
            def log_message(self, *args):
                pass

        class QuietServer(http.server.ThreadingHTTPServer):
            def handle_error(self, request, client_address):
                # Chrome drops its keep-alive connections when the test ends; that is expected, not an error.
                pass

        self.server = QuietServer(("127.0.0.1", 0), functools.partial(Quiet, directory=self.dir))
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def set(self, name, html):
        Path(self.dir, name).write_text(html, encoding="utf-8")

    def url(self, name):
        return f"http://localhost:{self.port}/{name}"

    def close(self):
        self.server.shutdown()
        shutil.rmtree(self.dir, ignore_errors=True)


class Results:
    def __init__(self, title):
        self.title = title
        self.rows = []

    def check(self, name, ok, detail=""):
        self.rows.append((bool(ok), name, detail))
        print(("  PASS  " if ok else "  FAIL  ") + name + ("" if ok or not detail else "  -> " + str(detail)))
        return bool(ok)

    def finish(self):
        failed = [r for r in self.rows if not r[0]]
        print(f"\n{self.title}: {len(self.rows) - len(failed)}/{len(self.rows)} checks passed")
        return 1 if failed else 0


def settle(page, selector="body", quiet_ms=400, timeout_ms=8000):
    """Wait until the text of `selector` has stopped changing for `quiet_ms`; returns the final text.

    The popup renders in stages (results first, history after a storage read), so a fixed sleep is either wasteful or
    flaky. Waiting for the UI to go quiet is neither.
    """
    deadline = time.time() + timeout_ms / 1000
    last, since = None, time.time()
    while time.time() < deadline:
        current = page.evaluate("(s) => { const n = document.querySelector(s); return n ? n.innerText : ''; }", selector)
        if current != last:
            last, since = current, time.time()
        elif (time.time() - since) * 1000 >= quiet_ms:
            return current
        page.wait_for_timeout(100)
    return last


def _override(target, mode):
    return """(() => {
  const TARGET = %s, MODE = %s;
  const q = chrome.tabs.query.bind(chrome.tabs);
  chrome.tabs.query = async () => {
    const all = await q({});
    const t = all.find((x) => x.url && x.url.includes(TARGET));
    return t ? [MODE === 'incognito' ? { ...t, incognito: true } : t] : [];
  };
  if (MODE === 'storage_error') {
    const set = chrome.storage.local.set.bind(chrome.storage.local);
    chrome.storage.local.set = async (o) => {
      if (Object.keys(o).some((k) => /^(h|th):/.test(k))) throw new Error('QUOTA_BYTES quota exceeded');
      return set(o);
    };
  }
})()""" % (json.dumps(target), json.dumps(mode))


class Session:
    def __init__(self, ctx, ext_id):
        self.ctx = ctx
        self.ext_id = ext_id
        self._probe = None

    def open_tab(self, url):
        page = self.ctx.new_page()
        page.goto(url, wait_until="load")
        return page

    def popup(self, target_url_fragment, mode="", width=400, height=600, wait_for="#app:not([hidden])", html="popup.html"):
        """Open the extension popup as a tab, pointed at the tab whose URL contains target_url_fragment.

        mode: "" (normal), "incognito" (the tab reports incognito: true) or "storage_error" (history writes throw).
        """
        pop = self.ctx.new_page()
        pop.add_init_script(_override(target_url_fragment, mode))
        pop.set_viewport_size({"width": width, "height": height})
        pop.goto(f"chrome-extension://{self.ext_id}/{html}")
        pop.wait_for_selector(wait_for, timeout=30000)
        settle(pop)
        return pop

    def probe(self):
        """A background extension page used to read and write chrome.storage from the tests."""
        if self._probe is None or self._probe.is_closed():
            self._probe = self.ctx.new_page()
            self._probe.goto(f"chrome-extension://{self.ext_id}/popup.html")
        return self._probe

    def storage_get(self, keys=None):
        return self.probe().evaluate("async (k) => chrome.storage.local.get(k)", keys)

    def storage_set(self, values):
        return self.probe().evaluate("async (v) => chrome.storage.local.set(v)", values)


@contextlib.contextmanager
def chrome_with_extension(extension_dir):
    extension_dir = Path(extension_dir).resolve()
    work = Path(tempfile.mkdtemp(prefix="ext-test-"))
    ext_copy = work / "ext"
    shutil.copytree(extension_dir, ext_copy)
    manifest_path = ext_copy / "manifest.json"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest.pop("optional_host_permissions", None)
    manifest["host_permissions"] = ["<all_urls>"]
    manifest_path.write_text(json.dumps(manifest, indent=2), encoding="utf-8")

    port = free_port()
    proc = subprocess.Popen([
        find_chrome(), f"--remote-debugging-port={port}", f"--user-data-dir={work / 'profile'}",
        "--enable-unsafe-extension-debugging", "--no-first-run", "--no-default-browser-check", "about:blank",
    ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(60):
            try:
                urllib.request.urlopen(f"http://127.0.0.1:{port}/json/version", timeout=1)
                break
            except Exception:
                time.sleep(0.5)
        else:
            raise SystemExit("Chrome did not start")
        with sync_playwright() as p:
            browser = p.chromium.connect_over_cdp(f"http://127.0.0.1:{port}")
            ext_id = browser.new_browser_cdp_session().send("Extensions.loadUnpacked", {"path": str(ext_copy)})["id"]
            try:
                yield Session(browser.contexts[0], ext_id)
            finally:
                browser.close()
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=10)
        except Exception:
            proc.kill()
        shutil.rmtree(work, ignore_errors=True)
