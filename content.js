'use strict';
// LeetCode Study Studio, page side: applies the theme, runs blind mode and the solution lock, tracks time, listens for
// submission verdicts (relayed by hook.js) and drives the review / mistake / notes UI. Depends on srs.js (global LCS).
(() => {
  if (window.__lcsContent) return;
  window.__lcsContent = true;

  const DEFAULTS = {
    enabled: true, theme: 'midnight', blind: false, lock: true, lockMinutes: 15,
    timer: true, celebrate: true, motion: 'auto', overlay: 80, hasBg: false,
  };
  const DARK_THEMES = new Set(['midnight', 'arcade', 'studio']);
  const BAD_VERDICTS = new Set(['Wrong Answer', 'Time Limit Exceeded', 'Runtime Error', 'Memory Limit Exceeded', 'Compile Error', 'Output Limit Exceeded']);
  const root = document.documentElement;
  let S = { ...DEFAULTS };

  const store = {
    get: (k) => new Promise((res) => { try { chrome.storage.local.get(k, (v) => res(v || {})); } catch { res({}); } }),
    set: (o) => new Promise((res) => { try { chrome.storage.local.set(o, () => res()); } catch { res(); } }),
  };

  // ---------- Tiny DOM helper (never uses innerHTML with page-derived text) ----------
  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null) el.append(kid.nodeType ? kid : document.createTextNode(kid));
    return el;
  }
  const svg = (paths) => {
    const wrap = document.createElement('span');
    wrap.innerHTML = `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
    return wrap.firstChild;
  };
  const ICON = {
    note: '<path d="M4 4h12l4 4v12H4z"/><path d="M8 12h8M8 16h5"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    eyeOff: '<path d="M3 3l18 18"/><path d="M10.6 5.1A10 10 0 0 1 12 5c6.5 0 10 7 10 7a17 17 0 0 1-3.2 4.1M6.5 6.6C3.7 8.4 2 12 2 12s3.5 7 10 7c1.7 0 3.2-.4 4.5-1"/>',
    bulb: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-4 10.5c.8.8 1 1.5 1 2.5h6c0-1 .2-1.7 1-2.5A6 6 0 0 0 12 3z"/>',
  };

  // ---------- Theme ----------
  let forcedScheme = false;
  function applyScheme() {
    const t = root.dataset.lcsTheme;
    if (!t) return;
    const want = DARK_THEMES.has(t) ? 'dark' : 'light';
    const other = want === 'dark' ? 'light' : 'dark';
    if (root.classList.contains(want) && !root.classList.contains(other)) return;
    forcedScheme = true;
    root.classList.remove(other);
    root.classList.add(want);
  }
  try {
    const early = localStorage.getItem('lcs_theme');
    if (early && early !== 'off') { root.dataset.lcsTheme = early; applyScheme(); }
  } catch { /* storage can be unavailable; the stored settings below still apply */ }
  // LeetCode re-applies its own mode on some navigations; keep ours.
  new MutationObserver(applyScheme).observe(root, { attributes: true, attributeFilter: ['class'] });

  // The code editor picks its syntax colours when LeetCode first draws it, so forcing a dark theme onto a page that
  // loaded light leaves dark-blue code on a dark editor. Monaco publishes its token colours as `.mtkN { color }` rules in
  // one small <style>; this writes an override that moves each colour's lightness to suit the active theme.
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    if (max === min) return [0, 0, l];
    const d = max - min, s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    const hue = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [hue * 60, s, l];
  }
  function adjustToken(hex, dark) {
    const n = parseInt(hex.slice(1, 7), 16);
    const [hue, s, l0] = rgbToHsl((n >> 16) & 255, (n >> 8) & 255, n & 255);
    const gray = s < 0.15;
    const l = dark ? Math.max(l0, gray ? 0.8 : 0.68) : Math.min(l0, gray ? 0.16 : 0.32);
    return `hsl(${Math.round(hue)} ${Math.round(s * 100)}% ${Math.round(l * 100)}%)`;
  }
  function fixTokens() {
    let tag = document.getElementById('lcs-mtk');
    const t = root.dataset.lcsTheme;
    if (!t) { if (tag) tag.remove(); return; }
    const src = [...document.querySelectorAll('style')].find((s) => s.id !== 'lcs-mtk' && s.textContent.length < 20000 && /\.mtk1\s*\{/.test(s.textContent));
    if (!src) return;
    const key = `${t}|${src.textContent}`;
    if (tag && tag.dataset.key === key) return;
    const dark = DARK_THEMES.has(t);
    let css = '';
    for (const m of src.textContent.matchAll(/\.(mtk\d+)\s*\{\s*color:\s*(#[0-9a-fA-F]{6})/g)) css += `html[data-lcs-theme] .monaco-editor .${m[1]}{color:${adjustToken(m[2], dark)} !important}\n`;
    if (!tag) { tag = document.createElement('style'); tag.id = 'lcs-mtk'; document.head.append(tag); }
    tag.textContent = css;
    tag.dataset.key = key;
  }

  async function applyBackground() {
    if (S.theme !== 'studio' || !S.hasBg) { root.style.removeProperty('--lcs-bg-image'); return; }
    const { bgImage } = await store.get('bgImage');
    if (typeof bgImage === 'string' && bgImage.startsWith('data:image/')) root.style.setProperty('--lcs-bg-image', `url("${bgImage}")`);
  }

  function applySettings() {
    const on = S.enabled && S.theme !== 'off';
    if (on) { root.dataset.lcsTheme = S.theme; applyScheme(); }
    else {
      delete root.dataset.lcsTheme;
      root.style.removeProperty('--lcs-bg-image');
      if (forcedScheme) { forcedScheme = false; toast('Reload the page to restore LeetCode’s own colours', 'Reload', () => location.reload()); }
    }
    try { localStorage.setItem('lcs_theme', on ? S.theme : 'off'); } catch { /* optional */ }
    root.style.setProperty('--lcs-alpha', String(Math.min(0.95, Math.max(0.35, S.overlay / 100))));
    root.toggleAttribute('data-lcs-blind', S.enabled && S.blind);
    root.toggleAttribute('data-lcs-lock', S.enabled && S.lock);
    if (S.motion === 'off') root.dataset.lcsMotion = 'off'; else delete root.dataset.lcsMotion;
    applyBackground();
    if (!S.enabled || !S.blind) clearBlind();
    refreshLock();
    renderDock();
    scheduleScan();
  }

  // ---------- Blind mode ----------
  const REVEALABLE = '[data-lcs-diff], a[href^="/tag/"], [class*="text-difficulty-"]';
  let scanQueued = false;
  function scheduleScan() {
    if (scanQueued || !S.enabled || !S.blind) return;
    scanQueued = true;
    setTimeout(() => { scanQueued = false; scanDifficulty(); }, 250);
  }
  // Difficulty words appear in many differently-classed elements (list rows, similar problems), so mark by content.
  function scanDifficulty() {
    for (const el of document.querySelectorAll('div, span')) {
      if (el.childElementCount) continue;
      const t = el.textContent;
      if (t.length > 6 || !/^(Easy|Medium|Hard)$/.test(t.trim())) continue;
      if (el.closest('.lcs-root')) continue;
      el.setAttribute('data-lcs-diff', '');
    }
  }
  function clearBlind() { document.querySelectorAll('[data-lcs-diff]').forEach((e) => e.removeAttribute('data-lcs-diff')); clearReveals(); }
  function clearReveals() { document.querySelectorAll('[data-lcs-reveal]').forEach((e) => e.removeAttribute('data-lcs-reveal')); }
  document.addEventListener('click', (e) => {
    if (!S.enabled || !S.blind || !(e.target instanceof Element)) return;
    const el = e.target.closest(REVEALABLE);
    if (el && !el.hasAttribute('data-lcs-reveal')) {
      e.preventDefault(); e.stopPropagation();
      el.setAttribute('data-lcs-reveal', '');
    }
  }, true);

  // ---------- Per-problem record ----------
  let slug = null;
  let rec = null;
  let saveTimer = 0;
  const blankRec = (s) => ({ slug: s, title: '', seconds: 0, attempts: [], accepted: false, peeked: false, notes: '', pattern: '', ladder: {}, srs: null });

  async function loadRec(s) {
    const got = await store.get(`p:${s}`);
    if (slug !== s) return null;
    rec = { ...blankRec(s), ...(got[`p:${s}`] || {}) };
    return rec;
  }
  function save(now) {
    if (!rec) return;
    clearTimeout(saveTimer);
    const write = () => store.set({ [`p:${rec.slug}`]: rec });
    if (now) write(); else saveTimer = setTimeout(write, 400);
  }
  function readTitle() {
    const el = document.querySelector('[data-e2e-locator="question-title"]');
    const t = el && el.textContent.replace(/^\s*\d+\.\s*/, '').trim();
    return t || null;
  }

  // ---------- Timer and solution lock ----------
  let lastActive = Date.now();
  let lastFlush = 0;
  const bump = () => { lastActive = Date.now(); };
  for (const ev of ['keydown', 'pointerdown', 'scroll', 'wheel']) window.addEventListener(ev, bump, { capture: true, passive: true });
  let lastMove = 0;
  window.addEventListener('mousemove', () => { const n = Date.now(); if (n - lastMove > 1000) { lastMove = n; bump(); } }, { passive: true });

  const isUnlocked = () => !S.lock || !rec || rec.accepted || rec.peeked || rec.seconds >= S.lockMinutes * 60;
  function refreshLock() {
    for (const id of ['editorial_tab', 'solutions_tab']) {
      const el = document.getElementById(id);
      if (el) el.toggleAttribute('data-lcs-locked', S.enabled && S.lock && !isUnlocked());
    }
  }

  let timeEl = null;
  setInterval(() => {
    if (!rec || !slug) return;
    const active = document.visibilityState === 'visible' && Date.now() - lastActive < 120000;
    if (active) {
      const wasLocked = !isUnlocked();
      rec.seconds += 1;
      if (!rec.title) rec.title = readTitle() || '';
      if (wasLocked && isUnlocked()) { refreshLock(); toast('Hints unlocked: the editorial and solutions are open'); }
      if (Date.now() - lastFlush > 15000) { lastFlush = Date.now(); save(true); }
    }
    if (timeEl) { timeEl.textContent = LCS.formatDuration(rec.seconds); timeEl.dataset.idle = active ? '0' : '1'; }
  }, 1000);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(true); });

  // Opening the editorial or solutions while locked opens the hint ladder instead.
  // LeetCode's tab strip selects a tab on pointerdown, not click, so every stage of the gesture has to be stopped.
  for (const type of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'touchstart', 'touchend', 'click']) {
    document.addEventListener(type, (e) => {
      if (!S.enabled || !S.lock || !rec || isUnlocked() || !(e.target instanceof Element)) return;
      if (!e.target.closest('#editorial_tab, #solutions_tab')) return;
      e.preventDefault(); e.stopImmediatePropagation();
      if (type === 'click') openLadder();
    }, true);
  }

  // ---------- UI shell: dock, sheets, toasts, banners ----------
  let ui = null, dock = null, sheet = null, banner = null, noteBtn = null, eyeBtn = null, lockBtn = null;

  function mountUI() {
    if (ui || !document.body) return;
    ui = h('div', { class: 'lcs-root' });
    timeEl = h('span', { class: 'lcs-time', role: 'timer', 'aria-label': 'Time spent on this problem' }, '00:00');
    noteBtn = h('button', { class: 'lcs-btn', type: 'button', 'aria-label': 'Notes', title: 'Notes and key idea', onclick: () => (sheet && sheet.dataset.kind === 'notes' ? closeSheet() : openNotes()) }, svg(ICON.note));
    lockBtn = h('button', { class: 'lcs-btn', type: 'button', 'aria-label': 'Hint ladder', title: 'Hint ladder', onclick: openLadder }, svg(ICON.bulb));
    eyeBtn = h('button', { class: 'lcs-btn', type: 'button', 'aria-label': 'Blind mode', title: 'Blind mode: hide difficulty and topics', onclick: () => { S.blind = !S.blind; store.set({ settings: S }); applySettings(); } });
    dock = h('div', { class: 'lcs-dock', role: 'toolbar', 'aria-label': 'Study tools', hidden: true }, timeEl, noteBtn, lockBtn, eyeBtn);
    ui.append(dock);
    document.body.append(ui);
    renderDock();
  }
  function renderDock() {
    if (!dock) return;
    const show = S.enabled && !!slug;
    dock.hidden = !show;
    timeEl.hidden = !S.timer;
    lockBtn.hidden = !S.lock;
    eyeBtn.replaceChildren(svg(S.blind ? ICON.eyeOff : ICON.eye));
    eyeBtn.setAttribute('aria-pressed', String(!!S.blind));
    if (rec) timeEl.textContent = LCS.formatDuration(rec.seconds);
  }

  function closeSheet() { if (sheet) { sheet.remove(); sheet = null; } }
  function openSheet(kind, ...kids) {
    mountUI();
    closeSheet();
    sheet = h('section', { class: 'lcs-sheet', role: 'dialog', 'aria-modal': 'false', 'aria-label': kind, 'data-kind': kind }, ...kids);
    ui.append(sheet);
    const first = sheet.querySelector('button, textarea, input');
    if (first) first.focus({ preventScroll: true });
    return sheet;
  }
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (banner) { banner.remove(); banner = null; }
    if (sheet && sheet.contains(document.activeElement)) { e.stopPropagation(); closeSheet(); }
  }, true);

  function toast(text, actionLabel, action) {
    mountUI();
    const t = h('div', { class: 'lcs-toast', role: 'status' }, text);
    if (actionLabel) t.append(' ', h('button', { class: 'lcs-btn', type: 'button', style: 'min-height:32px;padding:0 10px', onclick: () => { t.remove(); action && action(); } }, actionLabel));
    ui.append(t);
    setTimeout(() => t.remove(), actionLabel ? 9000 : 3500);
  }

  const BANNERS = {
    midnight: { good: ['Accepted', 'Nicely done.'], bad: [null, 'Log why: it is the fastest way to improve.'] },
    paper: { good: ['Extra! Extra!', 'Problem solved.'], bad: ['Correction', null] },
    arcade: { good: ['K.O.!', 'Accepted'], bad: ['Continue?', null], perfect: ['Perfect!', 'First try'] },
    studio: { good: ['Cleared', 'Accepted'], bad: ['Not yet', null] },
  };
  function showBanner(kind, verdict, firstTry) {
    if (!S.celebrate || !S.enabled) return;
    mountUI();
    if (banner) banner.remove();
    const theme = S.theme in BANNERS ? S.theme : 'midnight';
    const set = BANNERS[theme];
    const pick = (kind === 'good' && firstTry && set.perfect) ? set.perfect : set[kind];
    banner = h('div', { class: 'lcs-banner', role: 'status', 'data-kind': kind, 'data-theme': theme, title: 'Click to dismiss' },
      h('strong', {}, pick[0] || verdict), pick[1] || verdict ? h('span', {}, pick[1] || verdict) : null);
    banner.addEventListener('click', () => { banner.remove(); banner = null; });
    ui.append(banner);
    const mine = banner;
    setTimeout(() => { if (banner === mine) { mine.remove(); banner = null; } }, 2600);
  }

  // ---------- Sheets ----------
  function openNotes() {
    if (!rec) return;
    const pattern = h('input', {
      type: 'text', value: rec.pattern || '', placeholder: 'Key idea, e.g. hash map of complements',
      'aria-label': 'Key idea', style: 'width:100%;min-height:44px;margin-bottom:10px;padding:0 12px;border-radius:10px;border:1px solid var(--u-border);background:var(--u-bg2);color:var(--u-text);font:inherit',
      oninput: (e) => { rec.pattern = e.target.value.slice(0, 120); save(); },
    });
    const area = h('textarea', {
      'aria-label': 'Notes', placeholder: 'What tripped you up? What would you tell yourself next time?',
      oninput: (e) => { rec.notes = e.target.value.slice(0, 20000); save(); },
    });
    area.value = rec.notes || '';
    openSheet('notes', h('h2', {}, rec.title || 'Notes'), h('p', {}, 'Saved in your browser as you type.'), pattern, area,
      h('div', { class: 'lcs-row' }, h('button', { class: 'lcs-btn boxed', type: 'button', onclick: () => { save(true); closeSheet(); } }, 'Done')));
  }

  function openLadder() {
    if (!rec) return;
    const unlocked = isUnlocked();
    const left = Math.max(0, S.lockMinutes * 60 - rec.seconds);
    const L = rec.ladder || (rec.ladder = {});
    const steps = h('ol', { class: 'lcs-steps' });
    const mark = (key) => { L[key] = true; save(true); openLadder(); };
    const stepEl = (n, title, body, key, ...extra) => h('li', { class: 'lcs-step', 'data-done': L[key] ? '1' : '0' },
      h('b', {}, L[key] ? '✓' : String(n)),
      h('div', {}, h('strong', {}, title), h('div', { class: 'lcs-meta' }, body), ...extra),
      L[key] ? null : h('button', { class: 'lcs-chip', type: 'button', 'aria-label': `Mark step ${n} done`, onclick: () => mark(key) }, 'Done'));
    const guess = h('input', {
      type: 'text', value: L.guess || '', placeholder: 'e.g. two pointers, hash map',
      'aria-label': 'Your guess for the pattern',
      style: 'width:100%;min-height:44px;margin-top:8px;padding:0 12px;border-radius:10px;border:1px solid var(--u-border);background:var(--u-bg);color:var(--u-text);font:inherit',
      oninput: (e) => { L.guess = e.target.value.slice(0, 80); save(); },
    });
    steps.append(
      stepEl(1, 'Say it back', 'Restate the problem and trace one example by hand.', 's1'),
      stepEl(2, 'Guess a pattern', 'Commit to a technique before you look. A wrong guess still teaches.', 's2', guess),
      stepEl(3, 'Peek at the topics', 'Shows the topic tags and nothing else.', 's3'),
    );
    const done = L.s1 && L.s2 && L.s3;
    const row = h('div', { class: 'lcs-row' });
    const openTab = () => { closeSheet(); const t = document.getElementById('solutions_tab'); if (t) t.click(); };
    if (unlocked) row.append(h('button', { class: 'lcs-btn primary', type: 'button', onclick: openTab }, 'Open solutions'));
    else row.append(h('button', {
      class: 'lcs-btn primary', type: 'button', disabled: !done, title: done ? '' : 'Finish the three steps first',
      onclick: () => { rec.peeked = true; rec.attempts.push({ ts: Date.now(), verdict: 'Peeked', sec: rec.seconds }); save(true); refreshLock(); openTab(); },
    }, 'I’m stuck, unlock now'));
    row.append(h('button', { class: 'lcs-btn boxed', type: 'button', onclick: closeSheet }, 'Keep trying'));
    if (L.s3) revealTags();
    openSheet('hint ladder',
      h('h2', {}, 'Before you open the solutions'),
      h('p', {}, unlocked ? 'You have put in the time. Open them when you are ready.' : `Locked for ${LCS.formatDuration(left)} more of active work. Climb the ladder first.`),
      steps, row);
  }
  function revealTags() {
    document.querySelectorAll('a[href^="/tag/"]').forEach((a) => a.setAttribute('data-lcs-reveal', ''));
    const chip = [...document.querySelectorAll('div, span')].find((e) => !e.childElementCount && e.textContent.trim() === 'Topics' && !e.closest('.lcs-root'));
    if (chip) chip.click();
  }

  function openGrade() {
    if (!rec) return;
    const now = Date.now();
    const days = (grade) => LCS.rate(rec.srs, grade, now).interval;
    const label = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };
    const hint = { again: 'Could not recall it', hard: 'Got it with effort', good: 'Recalled the approach', easy: 'Instant' };
    const row = h('div', { class: 'lcs-row' }, LCS.GRADES.map((g) => h('button', {
      class: 'lcs-chip', type: 'button', style: 'flex:1 1 140px;text-align:left;padding:8px 12px',
      onclick: () => {
        rec.srs = LCS.rate(rec.srs, g, Date.now()); save(true); closeSheet();
        toast(`See it again in ${rec.srs.interval} day${rec.srs.interval === 1 ? '' : 's'}`);
      },
    }, h('strong', {}, `${label[g]} · ${days(g)}d`), h('div', { class: 'lcs-meta' }, hint[g]))));
    openSheet('review grade', h('h2', {}, 'How did that go?'), h('p', {}, 'Your answer sets when this problem comes back for review.'), row,
      h('div', { class: 'lcs-row' }, h('button', { class: 'lcs-btn boxed', type: 'button', onclick: closeSheet }, 'Skip')));
  }

  function openMistake(attempt) {
    const chips = LCS.MISTAKES.map(([key, text]) => h('button', {
      class: 'lcs-chip', type: 'button', 'aria-pressed': 'false',
      onclick: (e) => {
        attempt.mistake = key; save(true);
        chips.forEach((c) => c.setAttribute('aria-pressed', String(c === e.currentTarget)));
        setTimeout(closeSheet, 350);
      },
    }, text));
    openSheet('mistake log', h('h2', {}, 'What went wrong?'), h('p', {}, 'One tap. Patterns in your mistakes show up in the popup.'),
      h('div', { class: 'lcs-row' }, chips),
      h('div', { class: 'lcs-row' }, h('button', { class: 'lcs-btn boxed', type: 'button', onclick: closeSheet }, 'Skip')));
  }

  // ---------- Verdicts ----------
  const seen = new Set();
  let pendingSubmit = false;
  let pendingAt = 0;
  let lastHookAt = 0;
  const markSubmit = () => { pendingSubmit = true; pendingAt = Date.now(); };
  document.addEventListener('click', (e) => { if (e.target instanceof Element && e.target.closest('[data-e2e-locator="console-submit-button"]')) markSubmit(); }, true);
  document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && !e.shiftKey) markSubmit(); }, true);

  async function recordVerdict(v) {
    if (!S.enabled || !slug) return;
    if (seen.has(v.id)) return;
    seen.add(v.id);
    pendingSubmit = false;
    if (!rec) await loadRec(slug);
    if (!rec) return;
    if (!rec.title) rec.title = readTitle() || '';
    const priorFails = rec.attempts.filter((a) => a.verdict !== 'Accepted' && a.verdict !== 'Peeked').length;
    const attempt = { ts: Date.now(), id: v.id, verdict: v.verdict, sec: rec.seconds, runtime: v.runtime, memory: v.memory, lang: v.lang };
    rec.attempts.push(attempt);
    if (rec.attempts.length > 200) rec.attempts.splice(0, rec.attempts.length - 200);
    if (v.verdict === 'Accepted') {
      const firstSolve = !rec.accepted;
      rec.accepted = true;
      if (firstSolve) rec.firstAcceptedAt = attempt.ts;
      const got = await store.get('days');
      const days = new Set(got.days || []);
      days.add(LCS.dayKey(attempt.ts));
      await store.set({ days: [...days].sort().slice(-400) });
      save(true); refreshLock();
      showBanner('good', v.verdict, firstSolve && priorFails === 0 && !rec.peeked);
      const dueNow = !rec.srs || rec.srs.due < LCS.addDays(Date.now(), 1);
      if (dueNow) setTimeout(openGrade, S.celebrate ? 1200 : 0);
    } else if (BAD_VERDICTS.has(v.verdict)) {
      save(true);
      showBanner('bad', v.verdict, false);
      setTimeout(() => openMistake(attempt), S.celebrate ? 900 : 0);
    } else save(true);
  }

  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.source !== 'lcs-hook' || typeof d.id !== 'string' || typeof d.verdict !== 'string') return;
    lastHookAt = Date.now();
    recordVerdict({ id: d.id, verdict: d.verdict.slice(0, 40), runtime: d.runtime, memory: d.memory, lang: d.lang });
  });

  // Fallback if LeetCode changes its network calls: read the verdict from the page, but only right after a submit,
  // so opening an old submission in the Submissions tab is never counted.
  function domFallback() {
    if (!pendingSubmit || Date.now() - pendingAt > 90000 || Date.now() - lastHookAt < 10000) return;
    const el = document.querySelector('[data-e2e-locator="submission-result"]');
    const text = el && el.textContent.trim();
    if (text && (text === 'Accepted' || BAD_VERDICTS.has(text))) recordVerdict({ id: `dom-${pendingAt}`, verdict: text });
  }

  // ---------- Routing (LeetCode is a single-page app) ----------
  let lastPath = '';
  async function onRoute() {
    const path = location.pathname;
    if (path === lastPath) return;
    lastPath = path;
    const s = LCS.slugFromPath(path);
    clearReveals();
    closeSheet();
    if (s !== slug) {
      if (rec) save(true);
      slug = s; rec = null;
      if (s) {
        await loadRec(s);
        mountUI(); renderDock(); refreshLock();
        if (rec && rec.srs && rec.srs.due < LCS.addDays(Date.now(), 1)) toast('Due for review: solve it again, then rate how it went');
      } else renderDock();
    }
    // Deep link to the editorial/solutions while locked: send the user back to the statement and show the ladder.
    if (s && rec && S.enabled && S.lock && !isUnlocked() && /^\/problems\/[^/]+\/(editorial|solutions)/.test(path)) {
      const back = document.getElementById('description_tab');
      if (back) back.click();
      openLadder();
    }
    scheduleScan();
  }

  function tick() {
    if (!document.body) return;
    mountUI();
    onRoute();
    refreshLock();
    domFallback();
    fixTokens();
    if (rec && !rec.title) { const t = readTitle(); if (t) { rec.title = t; save(); } }
  }
  const domObserver = new MutationObserver(() => { scheduleScan(); });
  function boot() {
    if (document.body) domObserver.observe(document.body, { childList: true, subtree: true });
    setInterval(tick, 500);
    tick();
  }

  // ---------- Settings ----------
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.settings || changes.bgImage) {
      if (changes.settings) S = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
      applySettings();
    }
  });
  store.get('settings').then(({ settings }) => {
    S = { ...DEFAULTS, ...(settings || {}) };
    applySettings();
  });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true }); else boot();
})();
