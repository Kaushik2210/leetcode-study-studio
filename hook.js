// Runs in the page's own JavaScript world (manifest "world": "MAIN") so it can see LeetCode's network calls, which
// an isolated content script cannot. It only listens: it passes a copy of each submission-check result to the
// content script through window.postMessage and never changes a request or a response.
(() => {
  if (window.__lcsHooked) return;
  window.__lcsHooked = true;

  // Only numeric ids: "Run code" checks use ids like runcode_..., so test runs are never mistaken for submissions.
  const CHECK = /\/submissions\/detail\/(\d+)\/check\/?(?:\?|$)/;

  function report(url, text) {
    const m = CHECK.exec(url);
    if (!m) return;
    let data;
    try { data = JSON.parse(text); } catch { return; }
    // The check endpoint answers PENDING / STARTED until judging finishes; only the final answer matters.
    if (!data || data.state !== 'SUCCESS' || !data.status_msg) return;
    window.postMessage({
      source: 'lcs-hook',
      id: m[1],
      verdict: String(data.status_msg),
      runtime: data.status_runtime || null,
      memory: data.status_memory || null,
      lang: data.lang || null,
      passed: Number.isFinite(data.total_correct) ? data.total_correct : null,
      total: Number.isFinite(data.total_testcases) ? data.total_testcases : null,
    }, window.location.origin);
  }

  const origFetch = window.fetch;
  window.fetch = function (...args) {
    const p = origFetch.apply(this, args);
    try {
      const req = args[0];
      const url = typeof req === 'string' ? req : (req && req.url) || '';
      if (CHECK.test(url)) p.then((res) => res.clone().text().then((t) => report(url, t))).catch(() => {});
    } catch { /* never interfere with the page */ }
    return p;
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    try {
      if (CHECK.test(String(url))) {
        this.addEventListener('load', () => report(String(url), this.responseText));
      }
    } catch { /* ignore */ }
    return open.call(this, method, url, ...rest);
  };
})();
