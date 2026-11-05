'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { load } = require('./helpers.js');

const { get } = load(['srs.js']);
const LCS = get('LCS');
const at = (y, m, d, h = 12) => new Date(y, m - 1, d, h).getTime();
const daysBetween = (a, b) => Math.round((new Date(b).setHours(0, 0, 0, 0) - new Date(a).setHours(0, 0, 0, 0)) / 86400000);

test('first solve schedules by grade', () => {
  const now = at(2026, 11, 5);
  assert.equal(LCS.rate(undefined, 'again', now).interval, 1);
  assert.equal(LCS.rate(undefined, 'hard', now).interval, 2);
  assert.equal(LCS.rate(undefined, 'good', now).interval, 3);
  assert.equal(LCS.rate(undefined, 'easy', now).interval, 7);
});

test('due date is that many calendar days ahead, at local midnight', () => {
  const now = at(2026, 11, 5, 23);
  const c = LCS.rate(undefined, 'good', now);
  assert.equal(daysBetween(now, c.due), 3);
  assert.equal(new Date(c.due).getHours(), 0);
});

test('good reviews grow the interval and never shrink it', () => {
  let c = LCS.rate(undefined, 'good', at(2026, 1, 1));
  let prev = c.interval;
  for (let i = 0; i < 4; i++) { // 3 -> 7 -> 16 -> 37 -> 84 days, still under the 180 day cap
    c = LCS.rate(c, 'good', c.due);
    assert.ok(c.interval > prev, `${c.interval} should exceed ${prev}`);
    prev = c.interval;
  }
});

test('easy grows faster than good, hard slower', () => {
  const base = LCS.rate(LCS.rate(undefined, 'good', at(2026, 1, 1)), 'good', at(2026, 1, 4));
  const now = base.due;
  const easy = LCS.rate(base, 'easy', now).interval;
  const good = LCS.rate(base, 'good', now).interval;
  const hard = LCS.rate(base, 'hard', now).interval;
  assert.ok(easy > good && good > hard, `${easy} > ${good} > ${hard}`);
});

test('again resets to one day, counts a lapse and lowers ease', () => {
  const grown = LCS.rate(LCS.rate(undefined, 'good', at(2026, 1, 1)), 'good', at(2026, 1, 4));
  const c = LCS.rate(grown, 'again', grown.due);
  assert.equal(c.interval, 1);
  assert.equal(c.lapses, 1);
  assert.equal(c.reps, 0);
  assert.ok(c.ease < grown.ease);
});

test('ease and interval stay within bounds', () => {
  let c;
  for (let i = 0; i < 40; i++) c = LCS.rate(c, 'easy', at(2026, 1, 1));
  assert.ok(c.ease <= 3 && c.interval <= 180);
  for (let i = 0; i < 40; i++) c = LCS.rate(c, 'again', at(2026, 1, 1));
  assert.ok(c.ease >= 1.3);
});

test('rate does not mutate its input and rejects unknown grades', () => {
  const c = LCS.rate(undefined, 'good', at(2026, 1, 1));
  const copy = JSON.parse(JSON.stringify(c));
  LCS.rate(c, 'easy', at(2026, 1, 4));
  assert.deepEqual(JSON.parse(JSON.stringify(c)), copy);
  assert.throws(() => LCS.rate(c, 'perfect', 0));
});

test('dueCards keeps today and overdue, drops the future, sorts oldest first', () => {
  const now = at(2026, 11, 5, 9);
  const mk = (slug, due) => ({ slug, srs: { due } });
  const list = [
    mk('future', at(2026, 11, 6, 0)),
    mk('today', at(2026, 11, 5, 0)),
    mk('late', at(2026, 11, 1, 0)),
    { slug: 'unscheduled' },
  ];
  assert.deepEqual(LCS.dueCards(list, now).map((p) => p.slug), ['late', 'today']);
});

test('streak counts back from today, or from yesterday when today is empty', () => {
  const now = at(2026, 11, 5);
  const keys = ['2026-11-05', '2026-11-04', '2026-11-03', '2026-11-01'];
  assert.equal(LCS.streak(keys, now), 3);
  assert.equal(LCS.streak(['2026-11-04', '2026-11-03'], now), 2);
  assert.equal(LCS.streak(['2026-11-02'], now), 0);
  assert.equal(LCS.streak([], now), 0);
});

test('streak survives a month boundary', () => {
  assert.equal(LCS.streak(['2026-12-01', '2026-11-30', '2026-11-29'], at(2026, 12, 1)), 3);
});

test('formatDuration and slugFromPath', () => {
  assert.equal(LCS.formatDuration(65), '01:05');
  assert.equal(LCS.formatDuration(3725), '1:02:05');
  assert.equal(LCS.formatDuration(-4), '00:00');
  assert.equal(LCS.slugFromPath('/problems/two-sum/description/'), 'two-sum');
  assert.equal(LCS.slugFromPath('/problemset/'), null);
});
