/**
 * Year-end Wrapped (2026-07-31, from the approved idea shortlist): the whole
 * app-year in superlatives. Days belong to the year their APP-day falls in
 * (rollover-aware, like every other time bucket here), so a 1am January 1st
 * finish still counts toward the year being toasted.
 *
 * Pure task-derived facts only. The delight half of a Wrapped — streak
 * record, discoveries, trivia score — lives in the engine's synced progress
 * and is read directly by the view, not funneled through here.
 */
import { appDayKey } from './time';
import { priorityRank, type List, type Task } from './types';

export interface YearWrapped {
  year: number;
  completions: number;
  /** Tasks created during the year — the other side of the ledger. */
  created: number;
  /** Completions per calendar month of the app-year, Jan..Dec. */
  byMonth: number[];
  busiestDay: { key: string; count: number } | null;
  busiestMonth: { month: number; count: number } | null;
  /** Distinct app-days with at least one completion. */
  activeDays: number;
  trackedMs: number;
  /** Up to three lists where the year's work actually happened. */
  topLists: Array<{ title: string; count: number }>;
  /** The year's most patient victory: completed this year, created longest ago. */
  longestHaul: { task: Task; waitDays: number } | null;
  /** Up to five headline completions: highest priority, then most recent. */
  topWins: Task[];
}

export function yearWrapped(
  tasks: Task[], lists: List[], now: Date, rolloverHour: number,
): YearWrapped {
  const year = Number(appDayKey(now, rolloverHour).slice(0, 4));
  const prefix = `${year}-`;

  const byMonth = new Array<number>(12).fill(0);
  const byDay = new Map<string, number>();
  const byList = new Map<string, number>();
  const winsPool: Task[] = [];
  let created = 0;
  let trackedMs = 0;
  let longestHaul: YearWrapped['longestHaul'] = null;

  for (const t of tasks) {
    if (t.deleted) continue;
    if (t.createdAt && appDayKey(new Date(t.createdAt), rolloverHour).startsWith(prefix)) {
      created += 1;
    }
    if (t.completedAt === undefined) continue;
    const key = appDayKey(new Date(t.completedAt), rolloverHour);
    if (!key.startsWith(prefix)) continue;

    winsPool.push(t);
    byMonth[Number(key.slice(5, 7)) - 1]! += 1;
    byDay.set(key, (byDay.get(key) ?? 0) + 1);
    byList.set(t.listId, (byList.get(t.listId) ?? 0) + 1);
    if (t.activeMs) trackedMs += t.activeMs;

    if (t.createdAt) {
      const waitDays = Math.floor((t.completedAt - t.createdAt) / 86_400_000);
      if (waitDays > (longestHaul?.waitDays ?? -1)) longestHaul = { task: t, waitDays };
    }
  }

  let busiestDay: YearWrapped['busiestDay'] = null;
  for (const [key, count] of byDay) {
    if (count > (busiestDay?.count ?? 0)) busiestDay = { key, count };
  }
  let busiestMonth: YearWrapped['busiestMonth'] = null;
  for (let m = 0; m < 12; m += 1) {
    if (byMonth[m]! > (busiestMonth?.count ?? 0)) busiestMonth = { month: m, count: byMonth[m]! };
  }

  const titles = new Map(lists.map((l) => [l.id, l.title]));
  const topLists = [...byList.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([listId, count]) => ({ title: titles.get(listId) ?? 'a lost list', count }));

  const topWins = [...winsPool]
    .sort((a, b) => {
      const byPriority = priorityRank(b.priority) - priorityRank(a.priority);
      if (byPriority !== 0) return byPriority;
      return b.completedAt! - a.completedAt!;
    })
    .slice(0, 5);

  return {
    year,
    completions: winsPool.length,
    created,
    byMonth,
    busiestDay,
    busiestMonth,
    activeDays: byDay.size,
    trackedMs,
    topLists,
    longestHaul,
    topWins,
  };
}

/**
 * The reveal gate: Wrapped opens December 1st (by app-day, naturally) and
 * stays open through the year's end. Before that the screen is a teaser —
 * anticipation is most of a Wrapped's charm.
 */
export function wrappedIsOpen(now: Date, rolloverHour: number): boolean {
  return appDayKey(now, rolloverHour).slice(5, 7) === '12';
}

/** Days until the December 1st reveal, by app-day; 0 when already open. */
export function daysUntilWrapped(now: Date, rolloverHour: number): number {
  if (wrappedIsOpen(now, rolloverHour)) return 0;
  const todayKey = appDayKey(now, rolloverHour);
  const [y, m, d] = todayKey.split('-').map(Number);
  const today = new Date(y!, m! - 1, d!);
  const reveal = new Date(y!, 11, 1);
  return Math.round((reveal.getTime() - today.getTime()) / 86_400_000);
}
