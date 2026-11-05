'use strict';
// Pure helpers shared by the content script, the service worker and the popup: spaced-repetition scheduling,
// streaks and small formatters. No browser APIs, so tests/unit can load this file in a bare Node vm context.
const LCS = (() => {
  const pad = (n) => String(n).padStart(2, '0');
  const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

  // Calendar maths uses local midnight so "due today" means the same thing as the user's own calendar.
  function dayKey(ts) {
    const d = new Date(ts);
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  function addDays(ts, n) {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n).getTime();
  }

  // How well you remembered the approach when a problem came back up for review.
  const GRADES = ['again', 'hard', 'good', 'easy'];
  const FIRST_STEP = { again: 1, hard: 2, good: 3, easy: 7 };
  const EASE_DELTA = { again: -0.2, hard: -0.15, good: 0, easy: 0.15 };
  const MAX_INTERVAL = 180;

  // A small SM-2 variant. `card` is the previous schedule (or undefined for a first solve); returns a new card.
  function rate(card, grade, now) {
    if (!GRADES.includes(grade)) throw new Error(`unknown grade: ${grade}`);
    const c = card ? { ...card } : { interval: 0, ease: 2.3, reps: 0, lapses: 0 };
    let interval;
    if (grade === 'again') interval = 1;
    else if (!c.reps) interval = FIRST_STEP[grade];
    else if (grade === 'hard') interval = Math.max(c.interval + 1, Math.round(c.interval * 1.2));
    else if (grade === 'good') interval = Math.max(c.interval + 1, Math.round(c.interval * c.ease));
    else interval = Math.max(c.interval + 2, Math.round(c.interval * c.ease * 1.3));
    c.ease = clamp(c.ease + EASE_DELTA[grade], 1.3, 3);
    if (grade === 'again') { c.lapses += 1; c.reps = 0; } else c.reps += 1;
    c.interval = Math.min(interval, MAX_INTERVAL);
    c.last = now;
    c.due = addDays(now, c.interval);
    return c;
  }

  // Problems with a schedule that falls due on or before the end of today, most overdue first.
  function dueCards(problems, now) {
    const limit = addDays(now, 1);
    return problems
      .filter((p) => p && p.srs && typeof p.srs.due === 'number' && p.srs.due < limit)
      .sort((a, b) => a.srs.due - b.srs.due);
  }

  // Consecutive days with at least one accepted solve, counted back from today (or from yesterday if you have not
  // solved anything yet today, so the streak is still alive until the day ends).
  function streak(dayKeys, now) {
    const days = new Set(dayKeys);
    let t = now;
    if (!days.has(dayKey(t))) t = addDays(t, -1);
    let n = 0;
    while (days.has(dayKey(t))) { n += 1; t = addDays(t, -1); }
    return n;
  }

  function formatDuration(sec) {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
  }

  // The reasons offered after a failed submission. Keeping the list short makes logging it a one-tap habit.
  const MISTAKES = [
    ['misread', 'Misread the problem'],
    ['edge', 'Missed an edge case'],
    ['approach', 'Wrong approach'],
    ['offbyone', 'Off-by-one / indexing'],
    ['complexity', 'Too slow (TLE)'],
    ['syntax', 'Syntax or API slip'],
  ];

  // problem-slug from a leetcode.com path such as /problems/two-sum/description/
  function slugFromPath(pathname) {
    const m = /^\/problems\/([^/]+)/.exec(pathname || '');
    return m ? m[1] : null;
  }

  return { dayKey, addDays, rate, dueCards, streak, formatDuration, slugFromPath, GRADES, MISTAKES };
})();
