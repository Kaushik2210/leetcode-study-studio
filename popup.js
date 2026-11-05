'use strict';
const DEFAULTS = {
  enabled: true, theme: 'midnight', blind: false, lock: true, lockMinutes: 15,
  timer: true, celebrate: true, motion: 'auto', overlay: 80, hasBg: false,
};
const THEMES = [
  ['midnight', 'Midnight', 'Calm, minimal dark', ['#0a0c11', '#191d27', '#8ab4ff']],
  ['paper', 'Vintage Paper', 'Cream sheets, walnut desk', ['#5a4230', '#f5ecd7', '#8a3b12']],
  ['arcade', 'Arcade', 'Retro pixel mood', ['#0f0b24', '#261d5c', '#ffd23f']],
  ['studio', 'Studio', 'Your own image behind it', ['#1b1038', '#6b3fa0', '#ff9ec7']],
  ['off', 'Original', 'LeetCode as shipped', ['#ffffff', '#f0f0f0', '#ffa116']],
];
const $ = (id) => document.getElementById(id);
let S = { ...DEFAULTS };

const save = () => chrome.storage.local.set({ settings: S });

function renderThemes() {
  const box = $('themes');
  box.replaceChildren();
  for (const [key, name, blurb, sw] of THEMES) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'theme'; b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(S.theme === key));
    b.tabIndex = S.theme === key ? 0 : -1;
    const swatch = document.createElement('div'); swatch.className = 'sw';
    for (const c of sw) { const i = document.createElement('i'); i.style.background = c; swatch.append(i); }
    const t = document.createElement('b'); t.textContent = name;
    const s = document.createElement('small'); s.textContent = blurb;
    b.append(swatch, t, s);
    b.addEventListener('click', () => { S.theme = key; save(); render(); });
    b.addEventListener('keydown', (e) => {
      const idx = THEMES.findIndex((x) => x[0] === S.theme);
      const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
      if (!dir) return;
      e.preventDefault();
      S.theme = THEMES[(idx + dir + THEMES.length) % THEMES.length][0]; save(); render();
      $('themes').querySelector('[aria-checked="true"]').focus();
    });
    box.append(b);
  }
}

function render() {
  document.body.classList.toggle('off', !S.enabled);
  $('enabled').checked = S.enabled;
  for (const k of ['blind', 'lock', 'timer', 'celebrate']) $(k).checked = !!S[k];
  $('lockMinutes').value = String(S.lockMinutes);
  $('lockRow').hidden = !S.lock;
  $('motion').value = S.motion;
  $('studio').hidden = S.theme !== 'studio';
  $('overlay').value = String(S.overlay);
  $('overlayVal').textContent = `${S.overlay}%`;
  $('clearBg').hidden = !S.hasBg;
  $('pick').textContent = S.hasBg ? 'Change background image' : 'Choose background image';
  renderThemes();
}

function bind() {
  $('enabled').addEventListener('change', (e) => { S.enabled = e.target.checked; save(); render(); });
  for (const k of ['blind', 'lock', 'timer', 'celebrate']) $(k).addEventListener('change', (e) => { S[k] = e.target.checked; save(); render(); });
  $('lockMinutes').addEventListener('change', (e) => { S.lockMinutes = Number(e.target.value); save(); });
  $('motion').addEventListener('change', (e) => { S.motion = e.target.value; save(); });
  $('overlay').addEventListener('input', (e) => { S.overlay = Number(e.target.value); $('overlayVal').textContent = `${S.overlay}%`; save(); });
  $('pick').addEventListener('click', () => $('file').click());
  $('file').addEventListener('change', async (e) => {
    const file = e.target.files && e.target.files[0];
    if (!file || !file.type.startsWith('image/')) return;
    try {
      const url = await downscale(file, 1920);
      await chrome.storage.local.set({ bgImage: url });
      S.hasBg = true; await save(); render();
    } catch { $('pick').textContent = 'Could not read that image'; }
  });
  $('clearBg').addEventListener('click', async () => { await chrome.storage.local.remove('bgImage'); S.hasBg = false; await save(); render(); });
  $('export').addEventListener('click', exportData);
}

// Resize to at most `max` px on the long edge so the stored image stays a few hundred KB.
async function downscale(file, max) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.82);
}

function el(tag, cls, text) { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }

async function renderStats() {
  const all = await chrome.storage.local.get(null);
  const problems = Object.entries(all).filter(([k]) => k.startsWith('p:')).map(([, v]) => v);
  const now = Date.now();
  const todayKey = LCS.dayKey(now);

  const due = LCS.dueCards(problems, now);
  $('dueCount').textContent = due.length ? String(due.length) : '';
  $('dueEmpty').hidden = due.length > 0;
  const list = $('due'); list.replaceChildren();
  for (const p of due.slice(0, 6)) {
    const li = el('li'); const a = el('a');
    a.href = `https://leetcode.com/problems/${encodeURIComponent(p.slug)}/`; a.target = '_blank'; a.rel = 'noopener';
    a.append(el('span', '', p.title || p.slug));
    const overdue = Math.max(0, Math.round((LCS.addDays(now, 0) - LCS.addDays(p.srs.due, 0)) / 86400000));
    a.append(el('small', '', [p.pattern, overdue ? `${overdue}d overdue` : 'due today'].filter(Boolean).join(' · ')));
    li.append(a); list.append(li);
  }

  const solved = problems.filter((p) => p.accepted);
  const solvedToday = new Set(problems.filter((p) => (p.attempts || []).some((a) => a.verdict === 'Accepted' && LCS.dayKey(a.ts) === todayKey)).map((p) => p.slug));
  const seconds = problems.reduce((n, p) => n + (p.seconds || 0), 0);
  $('sStreak').textContent = String(LCS.streak(all.days || [], now));
  $('sToday').textContent = String(solvedToday.size);
  $('sSolved').textContent = String(solved.length);
  $('sTime').textContent = seconds >= 3600 ? `${(seconds / 3600).toFixed(1)}h` : `${Math.round(seconds / 60)}m`;

  const counts = Object.fromEntries(LCS.MISTAKES.map(([k]) => [k, 0]));
  for (const p of problems) for (const a of p.attempts || []) if (a.mistake in counts) counts[a.mistake] += 1;
  const total = Math.max(1, ...Object.values(counts));
  const rows = LCS.MISTAKES.filter(([k]) => counts[k] > 0).sort((a, b) => counts[b[0]] - counts[a[0]]);
  $('mistakesEmpty').hidden = rows.length > 0;
  const bars = $('mistakes'); bars.replaceChildren();
  for (const [k, label] of rows) {
    const li = el('li'); const bar = el('div', 'bar'); const fill = el('i'); fill.style.width = `${(counts[k] / total) * 100}%`;
    bar.append(fill); li.append(el('span', '', label), bar, el('em', '', String(counts[k]))); bars.append(li);
  }
}

async function exportData() {
  const all = await chrome.storage.local.get(null);
  delete all.bgImage;
  const blob = new Blob([JSON.stringify({ exportedAt: new Date().toISOString(), data: all }, null, 2)], { type: 'application/json' });
  const a = el('a'); a.href = URL.createObjectURL(blob); a.download = `leetcode-study-studio-${LCS.dayKey(Date.now())}.json`;
  document.body.append(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

(async () => {
  const { settings } = await chrome.storage.local.get('settings');
  S = { ...DEFAULTS, ...(settings || {}) };
  bind(); render(); renderStats();
})();
