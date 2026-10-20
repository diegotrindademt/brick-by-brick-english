// Spaced repetition scheduler (SM-2 family, simplified for daily use).
// Pure functions only, so it can be tested in Node without a browser.

export const GRADES = { AGAIN: 0, HARD: 1, GOOD: 2, EASY: 3 };
export const MATURE_DAYS = 21;

const MIN_EASE = 1.3;
const MAX_INTERVAL = 365;

export function todayStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function addDays(dayStr, n) {
  const [y, m, d] = dayStr.split('-').map(Number);
  // Noon avoids daylight-saving edge cases.
  const date = new Date(y, m - 1, d, 12);
  date.setDate(date.getDate() + n);
  return todayStr(date);
}

export function daysBetween(a, b) {
  const [ya, ma, da] = a.split('-').map(Number);
  const [yb, mb, db] = b.split('-').map(Number);
  return Math.round((Date.UTC(yb, mb - 1, db) - Date.UTC(ya, ma - 1, da)) / 86400000);
}

export function newCard() {
  return { reps: 0, interval: 0, ease: 2.5, lapses: 0, due: null, last: null };
}

// Returns the interval (in days) a grade would produce, without changing the card.
export function nextInterval(card, grade) {
  const c = { ...newCard(), ...card };
  if (grade === GRADES.AGAIN) return 0;
  if (c.reps === 0) return grade === GRADES.EASY ? 4 : grade === GRADES.GOOD ? 1 : 1;
  if (c.reps === 1) return grade === GRADES.EASY ? 7 : grade === GRADES.GOOD ? 3 : 2;
  const ease = adjustEase(c.ease, grade);
  const factor = grade === GRADES.HARD ? 1.2 : grade === GRADES.GOOD ? ease : ease * 1.3;
  return Math.min(MAX_INTERVAL, Math.max(c.interval + 1, Math.round(c.interval * factor)));
}

function adjustEase(ease, grade) {
  const delta = grade === GRADES.HARD ? -0.15 : grade === GRADES.EASY ? 0.15 : 0;
  return Math.max(MIN_EASE, ease + delta);
}

export function review(card, grade, today) {
  const c = { ...newCard(), ...card };
  if (grade === GRADES.AGAIN) {
    return {
      ...c,
      reps: 0,
      interval: 0,
      lapses: c.lapses + 1,
      ease: Math.max(MIN_EASE, c.ease - 0.2),
      due: today,
      last: today,
    };
  }
  const interval = nextInterval(c, grade);
  return {
    ...c,
    reps: c.reps + 1,
    interval,
    ease: c.reps >= 2 ? adjustEase(c.ease, grade) : c.ease,
    due: addDays(today, interval),
    last: today,
  };
}

export function isDue(card, today) {
  return !!card && !!card.due && card.due <= today;
}

export function isMature(card) {
  return !!card && card.interval >= MATURE_DAYS;
}

export function formatInterval(days) {
  if (days <= 0) return 'agora';
  if (days === 1) return '1 dia';
  if (days < 30) return `${days} dias`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 mês' : `${months} meses`;
}

// Consecutive days with practice, counting back from today (or yesterday,
// so the streak doesn't look broken before today's session).
export function streak(log, today) {
  const practiced = (day) => (log[day]?.seconds || 0) >= 60;
  let day = practiced(today) ? today : addDays(today, -1);
  let count = 0;
  while (practiced(day)) {
    count += 1;
    day = addDays(day, -1);
  }
  return count;
}
