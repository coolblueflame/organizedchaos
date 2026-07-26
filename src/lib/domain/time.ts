/**
 * App-day time math (spec §3, "the 4am rule").
 *
 * A "day" flips at `rolloverHour` local time everywhere it matters: "Not Today"
 * snooze expiry, scheduled recurrence spawning, and stats bucketing. All logic
 * uses LOCAL time — deadlines are calendar dates in the user's timezone.
 */

/** Local calendar date of `d` as 'YYYY-MM-DD'. */
export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The calendar date of the app-day containing `now` (2am belongs to yesterday). */
export function appDayKey(now: Date, rolloverHour: number): string {
  const shifted = new Date(now.getTime());
  shifted.setHours(shifted.getHours() - rolloverHour);
  return dateKey(shifted);
}

/** The next app-day boundary strictly after `now`. */
export function nextRollover(now: Date, rolloverHour: number): Date {
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), rolloverHour);
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

export function nextRolloverTs(nowTs: number, rolloverHour: number): number {
  return nextRollover(new Date(nowTs), rolloverHour).getTime();
}

/** Parse a 'YYYY-MM-DD' key to local noon — noon keeps day arithmetic stable across DST. */
function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12);
}

/** Calendar-day arithmetic on date keys (crosses month/year boundaries correctly). */
export function addDaysKey(key: string, days: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** Whole app-days between now's app-day and the deadline date (today→0, past→negative). */
export function daysUntilDeadline(deadline: string, now: Date, rolloverHour: number): number {
  const nowDay = keyToDate(appDayKey(now, rolloverHour));
  const dueDay = keyToDate(deadline);
  return Math.round((dueDay.getTime() - nowDay.getTime()) / 86_400_000);
}
