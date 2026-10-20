import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GRADES, addDays, daysBetween, newCard, nextInterval, review, isDue, isMature, streak, formatInterval,
} from '../js/srs.js';

test('addDays crosses month and year boundaries', () => {
  assert.equal(addDays('2026-01-31', 1), '2026-02-01');
  assert.equal(addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(addDays('2026-03-01', -1), '2026-02-28');
});

test('daysBetween counts calendar days', () => {
  assert.equal(daysBetween('2026-10-01', '2026-10-20'), 19);
  assert.equal(daysBetween('2026-10-20', '2026-10-01'), -19);
});

test('first good answer schedules tomorrow, second schedules 3 days', () => {
  const t = '2026-10-20';
  let c = review(newCard(), GRADES.GOOD, t);
  assert.equal(c.interval, 1);
  assert.equal(c.due, '2026-10-21');
  c = review(c, GRADES.GOOD, '2026-10-21');
  assert.equal(c.interval, 3);
  assert.equal(c.due, '2026-10-24');
});

test('intervals grow after the learning phase', () => {
  let c = newCard();
  let day = '2026-10-20';
  const intervals = [];
  for (let i = 0; i < 6; i += 1) {
    c = review(c, GRADES.GOOD, day);
    intervals.push(c.interval);
    day = c.due;
  }
  for (let i = 1; i < intervals.length; i += 1) assert.ok(intervals[i] > intervals[i - 1], `${intervals}`);
  assert.ok(isMature(c));
});

test('again resets the card, lowers ease and keeps it due today', () => {
  const t = '2026-10-20';
  let c = newCard();
  for (let i = 0; i < 4; i += 1) c = review(c, GRADES.GOOD, t);
  const before = c.ease;
  c = review(c, GRADES.AGAIN, t);
  assert.equal(c.reps, 0);
  assert.equal(c.interval, 0);
  assert.equal(c.lapses, 1);
  assert.ok(c.ease < before);
  assert.ok(isDue(c, t));
});

test('ease never drops below the floor', () => {
  let c = newCard();
  for (let i = 0; i < 30; i += 1) c = review(c, GRADES.AGAIN, '2026-10-20');
  assert.ok(c.ease >= 1.3);
});

test('easy > good > hard for the same card', () => {
  let c = newCard();
  c = review(c, GRADES.GOOD, '2026-10-20');
  c = review(c, GRADES.GOOD, '2026-10-21');
  const hard = nextInterval(c, GRADES.HARD);
  const good = nextInterval(c, GRADES.GOOD);
  const easy = nextInterval(c, GRADES.EASY);
  assert.ok(hard < good && good < easy, `${hard} ${good} ${easy}`);
});

test('streak counts consecutive practice days and tolerates an unfinished today', () => {
  const log = {
    '2026-10-17': { seconds: 600 },
    '2026-10-18': { seconds: 900 },
    '2026-10-19': { seconds: 1200 },
  };
  assert.equal(streak(log, '2026-10-20'), 3);
  log['2026-10-20'] = { seconds: 300 };
  assert.equal(streak(log, '2026-10-20'), 4);
  assert.equal(streak(log, '2026-10-22'), 0);
});

test('formatInterval speaks Portuguese', () => {
  assert.equal(formatInterval(0), 'agora');
  assert.equal(formatInterval(1), '1 dia');
  assert.equal(formatInterval(12), '12 dias');
  assert.equal(formatInterval(60), '2 meses');
});
