/**
 * The week in review (2026-07-30, from the approved idea shortlist): what this
 * app-week actually looked like, compared to the last one. Weeks start Sunday
 * and days roll at the app's rollover hour, matching completionCounts.
 */
import { appDayKey } from './time';
import { estimateOutcome } from './stats';
import { priorityRank, type Task } from './types';

export interface WeekReview {
  /** App-day keys, Sunday first — index into `daily`. */
  dayKeys: string[];
  /** Completions per day, Sun..Sat of the current week. */
  daily: number[];
  completions: number;
  prevCompletions: number;
  bestDay: { key: string; count: number } | null;
  /** Actually-tracked working time across the week's completions. */
  trackedMs: number;
  /** Estimate scoreboard over completions where both sides exist. */
  estimates: { on: number; over: number; under: number } | null;
  /** Up to five headline completions: highest priority, then most recent. */
  topWins: Task[];
}

/** The Sunday-started app-week day keys containing `now` (offsetWeeks back). */
function weekKeys(now: Date, rolloverHour: number, offsetWeeks: number): string[] {
  const todayKey = appDayKey(now, rolloverHour);
  const [y, m, d] = todayKey.split('-').map(Number);
  const anchor = new Date(y!, m! - 1, d!);
  const sundayOffset = anchor.getDay(); // Sun=0 … Sat=6
  const keys: string[] = [];
  for (let i = 0; i < 7; i += 1) {
    const day = new Date(y!, m! - 1, d! - sundayOffset - offsetWeeks * 7 + i);
    keys.push(
      `${day.getFullYear()}-${String(day.getMonth() + 1).padStart(2, '0')}-${String(day.getDate()).padStart(2, '0')}`,
    );
  }
  return keys;
}

export function weekReview(tasks: Task[], now: Date, rolloverHour: number): WeekReview {
  const thisWeek = weekKeys(now, rolloverHour, 0);
  const lastWeek = new Set(weekKeys(now, rolloverHour, 1));
  const thisSet = new Set(thisWeek);

  const daily = new Array<number>(7).fill(0);
  const winsPool: Task[] = [];
  let prevCompletions = 0;
  let trackedMs = 0;
  let on = 0;
  let over = 0;
  let under = 0;
  let anyEstimate = false;

  for (const t of tasks) {
    if (t.deleted || t.completedAt === undefined) continue;
    const key = appDayKey(new Date(t.completedAt), rolloverHour);
    if (lastWeek.has(key)) prevCompletions += 1;
    if (!thisSet.has(key)) continue;
    daily[thisWeek.indexOf(key)]! += 1; // thisSet.has(key) guarantees membership
    winsPool.push(t);
    if (t.activeMs) trackedMs += t.activeMs;
    const outcome = estimateOutcome(t);
    if (outcome) {
      anyEstimate = true;
      if (outcome.verdict.includes('right on')) on += 1;
      else if ((t.activeMs ?? 0) > (t.estimateHours ?? 0) * 3_600_000) over += 1;
      else under += 1;
    }
  }

  const completions = winsPool.length;
  let bestDay: WeekReview['bestDay'] = null;
  for (let i = 0; i < 7; i += 1) {
    if (daily[i]! > (bestDay?.count ?? 0)) bestDay = { key: thisWeek[i]!, count: daily[i]! };
  }

  const topWins = [...winsPool]
    .sort((a, b) => {
      const byPriority = priorityRank(b.priority) - priorityRank(a.priority);
      if (byPriority !== 0) return byPriority;
      return b.completedAt! - a.completedAt!;
    })
    .slice(0, 5);

  return {
    dayKeys: thisWeek,
    daily,
    completions,
    prevCompletions,
    bestDay,
    trackedMs,
    estimates: anyEstimate ? { on, over, under } : null,
    topWins,
  };
}

/** The whole week's completions as a pasteable bullet list, oldest first. */
export function weekWinsList(tasks: Task[], now: Date, rolloverHour: number): string {
  const keys = new Set(weekKeys(now, rolloverHour, 0));
  return tasks
    .filter((t) => !t.deleted && t.completedAt !== undefined &&
      keys.has(appDayKey(new Date(t.completedAt), rolloverHour)))
    .sort((a, b) => a.completedAt! - b.completedAt!)
    .map((t) => `- ${t.name || 'untitled'}`)
    .join('\n');
}
