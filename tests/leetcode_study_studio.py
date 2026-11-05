"""LeetCode Study Studio: behaviour on a fixture page that copies the parts of LeetCode's markup the extension relies on.

Covers the theme and colour scheme, blind mode, the solution lock (including LeetCode's habit of switching tabs on
pointerdown), the timer, the network hook -> verdict -> review/mistake flow, de-duplication, run-code results being
ignored, settings changes applied live, and the popup's due list and statistics.

The extension only runs on leetcode.com, so the test loads a COPY whose content-script match is http://localhost/*.

Run:  python tests/leetcode_study_studio.py [--extension DIR]
"""
import argparse
import json
import shutil
import sys
import tempfile
from pathlib import Path

from harness import REPO, Results, Site, chrome_with_extension, settle

FIXTURE = """<!doctype html><html class="light"><head><meta charset=utf-8><title>Two Sum - fixture</title>
<style>body{font:16px sans-serif} .diff{color:#1cb8b8}</style></head><body>
<nav><button>Premium</button></nav>
<div data-e2e-locator="question-title">1. Two Sum</div>
<div class="diff text-difficulty-easy">Easy</div>
<a href="/tag/array/" id="tag">Array</a>
<div id="description_tab">Description</div>
<div id="solutions_tab">Solutions</div>
<button data-e2e-locator="console-submit-button" id="submit">Submit</button>
<script>
  window.__tab = [];
  const tab = document.getElementById('solutions_tab');
  for (const t of ['pointerdown', 'mousedown', 'click']) tab.addEventListener(t, () => window.__tab.push(t));
  window.__check = (id) => fetch('/submissions/detail/' + id + '/check/').then((r) => r.text());
</script></body></html>"""


def make_copy(src):
    """A temp copy of the extension that runs on the localhost fixture instead of leetcode.com."""
    dst = Path(tempfile.mkdtemp(prefix="lcs-ext-")) / "ext"
    shutil.copytree(src, dst, ignore=shutil.ignore_patterns(".git", "tests", ".github", "node_modules"))
    mpath = dst / "manifest.json"
    manifest = json.loads(mpath.read_text(encoding="utf-8"))
    for cs in manifest["content_scripts"]:
        cs["matches"] = ["http://localhost/*"]
    mpath.write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    return dst


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--extension", default=str(REPO))
    args = ap.parse_args()
    r = Results("LeetCode Study Studio")

    site = Site({})
    root = Path(site.dir)
    (root / "problems" / "two-sum" / "description").mkdir(parents=True)
    site.set("problems/two-sum/description/index.html", FIXTURE)
    for sid, body in {
        "777": {"state": "SUCCESS", "status_msg": "Accepted", "status_runtime": "3 ms"},
        "778": {"state": "STARTED", "status_msg": "Wrong Answer"},  # judging not finished: must be ignored even with a message
        "779": {"state": "SUCCESS", "status_msg": "Wrong Answer"},
        "runcode_1_x": {"state": "SUCCESS", "status_msg": "Accepted"},
    }.items():
        (root / "submissions" / "detail" / sid / "check").mkdir(parents=True)
        site.set(f"submissions/detail/{sid}/check/index.html", json.dumps(body))
    url = site.url("problems/two-sum/description/")
    ext = make_copy(args.extension)

    try:
        with chrome_with_extension(ext) as s:
            s.storage_set({"settings": {"theme": "paper", "enabled": True, "blind": True, "lock": True, "lockMinutes": 15}})
            page = s.open_tab(url)
            page.wait_for_selector(".lcs-dock:not([hidden])", timeout=15000)
            state = lambda js: page.evaluate(js)  # noqa: E731

            # --- theme and colour scheme ---
            r.check("paper theme sets the attribute and a light scheme",
                    state("document.documentElement.dataset.lcsTheme") == "paper" and state("document.documentElement.classList.contains('light')"))
            s.storage_set({"settings": {"theme": "midnight", "enabled": True, "blind": True, "lock": True}})
            page.wait_for_timeout(500)
            r.check("midnight forces the dark scheme", state("document.documentElement.classList.contains('dark') && !document.documentElement.classList.contains('light')"))
            r.check("body takes the theme background", state("getComputedStyle(document.body).backgroundColor") == "rgb(10, 12, 17)")

            # --- blind mode ---
            blurred = lambda sel: "blur" in state(f"getComputedStyle(document.querySelector('{sel}')).filter")  # noqa: E731

            def unblurred(sel):
                """True once the element has finished its 150 ms unblur transition (polled, never a fixed sleep)."""
                try:
                    page.wait_for_function("(s) => { const e = document.querySelector(s); return !!e && !getComputedStyle(e).filter.includes('blur'); }", arg=sel, timeout=3000)
                    return True
                except Exception:
                    return False

            r.check("difficulty is blurred", blurred(".diff"))
            r.check("topic tag is blurred", blurred("#tag"))
            page.click(".diff")
            r.check("clicking the difficulty reveals only it", unblurred(".diff") and blurred("#tag"))
            page.click("#tag")
            page.wait_for_timeout(400)  # long enough for a wrongly followed link to have navigated
            followed = page.url != url
            r.check("clicking a blurred tag reveals it without following the link", not followed and unblurred("#tag"), page.url)

            # --- solution lock ---
            page.click("#solutions_tab")
            page.wait_for_timeout(300)
            r.check("locked: pointerdown, mousedown and click never reach the tab", state("window.__tab.length") == 0, state("window.__tab"))
            r.check("locked: the hint ladder opens", state("!!document.querySelector('.lcs-sheet[data-kind=\"hint ladder\"]')"))
            r.check("the unlock button is disabled until the three steps are done",
                    state("document.querySelector('.lcs-sheet .lcs-btn.primary').disabled"))
            for _ in range(3):
                page.click(".lcs-sheet .lcs-step .lcs-chip")
                page.wait_for_timeout(150)
            page.click(".lcs-sheet .lcs-btn.primary")
            page.wait_for_timeout(300)
            r.check("after the ladder, 'I'm stuck' opens the tab and records a peek", state("window.__tab.includes('click')"))
            page.click("#solutions_tab")
            page.wait_for_timeout(200)
            r.check("once peeked, the tab is no longer blocked", state("window.__tab.includes('pointerdown')"))
            page.keyboard.press("Escape")

            # --- timer ---
            before = state("document.querySelector('.lcs-time').textContent")
            page.mouse.move(100, 100)
            page.wait_for_timeout(3200)
            after = state("document.querySelector('.lcs-time').textContent")
            r.check("the timer counts while the page is active", after > before, f"{before} -> {after}")

            # --- verdicts through the real network hook ---
            page.evaluate("window.__check('778')")
            page.evaluate("window.__check('runcode_1_x')")
            page.wait_for_timeout(600)
            rec = s.storage_get("p:two-sum")["p:two-sum"]
            r.check("a PENDING check and a run-code check are never recorded as submissions",
                    all(a.get("verdict") == "Peeked" for a in rec["attempts"]), rec["attempts"])

            page.evaluate("window.__check('779')")
            page.wait_for_timeout(2000)
            r.check("a wrong answer opens the mistake log", state("!!document.querySelector('.lcs-sheet[data-kind=\"mistake log\"]')"))
            page.click(".lcs-sheet .lcs-chip:nth-of-type(2)")
            page.wait_for_timeout(500)
            rec = s.storage_get("p:two-sum")["p:two-sum"]
            wrong = [a for a in rec["attempts"] if a["verdict"] == "Wrong Answer"]
            r.check("the chosen mistake is stored on that attempt", len(wrong) == 1 and wrong[0].get("mistake") == "edge", wrong)

            page.evaluate("window.__check('777')")
            page.wait_for_selector(".lcs-sheet[data-kind=\"review grade\"]", timeout=6000)
            r.check("an accepted submission opens the review grade sheet", True)
            r.check("the grade buttons preview their intervals", "Good · 3d" in state("document.querySelector('.lcs-sheet').innerText"))
            page.click(".lcs-sheet .lcs-chip:nth-of-type(3)")  # Good
            page.wait_for_timeout(500)
            stored = s.storage_get(None)
            rec = stored["p:two-sum"]
            r.check("accepted is recorded with the day in the streak list", rec["accepted"] and len(stored.get("days", [])) == 1, stored.get("days"))
            r.check("grading Good schedules the first review 3 days out", rec.get("srs", {}).get("interval") == 3, rec.get("srs"))
            n = len(rec["attempts"])
            page.evaluate("window.__check('777')")
            page.wait_for_timeout(600)
            r.check("the same submission id is not recorded twice", len(s.storage_get("p:two-sum")["p:two-sum"]["attempts"]) == n)

            # --- settings applied live ---
            s.storage_set({"settings": {"theme": "off", "enabled": True}})
            page.wait_for_timeout(500)
            r.check("choosing Original removes the theme", state("document.documentElement.dataset.lcsTheme") is None)
            s.storage_set({"settings": {"theme": "arcade", "enabled": False}})
            page.wait_for_timeout(500)
            r.check("turning the extension off hides the dock and blur", state("document.querySelector('.lcs-dock').hidden") and not blurred(".diff"))

            # --- popup: due list and statistics ---
            day = 86400000
            now = page.evaluate("Date.now()")
            s.storage_set({
                "settings": {"theme": "midnight", "enabled": True},
                "p:old-problem": {"slug": "old-problem", "title": "Old Problem", "pattern": "two pointers", "accepted": True, "seconds": 600,
                                  "attempts": [], "srs": {"due": now - 2 * day, "interval": 3, "ease": 2.3, "reps": 1, "lapses": 0}},
                "p:later": {"slug": "later", "title": "Later", "accepted": True, "seconds": 60, "attempts": [], "srs": {"due": now + 9 * day}},
            })
            pop = s.popup("localhost", wait_for="#main")
            text = settle(pop)
            r.check("the popup lists only problems that are due", "Old Problem" in text and "Later" not in text, text[:300])
            r.check("the due badge count is shown", pop.evaluate("document.getElementById('dueCount').textContent") == "1")
            r.check("the popup shows the key idea next to the due problem", "two pointers" in text)
            r.check("the popup counts solved problems", pop.evaluate("document.getElementById('sSolved').textContent") == "3")
            r.check("the mistake chart shows the logged reason", "Missed an edge case" in text)
            pop.click('.theme:has-text("Arcade")')
            pop.wait_for_timeout(300)
            r.check("choosing a theme in the popup saves it", s.storage_get("settings")["settings"]["theme"] == "arcade")
            pop.close()
    finally:
        site.close()
        shutil.rmtree(ext.parent, ignore_errors=True)
    return r.finish()


if __name__ == "__main__":
    sys.exit(main())
