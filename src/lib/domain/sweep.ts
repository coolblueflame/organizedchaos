/**
 * The triage sweep — getting an imported backlog reviewed in sessions, not years.
 *
 * The drip (the randomizer's occasional fill-in card) is right for maintenance
 * but hopeless against thousands of never-reviewed imported tasks: at a card
 * every few rolls it would take until the 2030s. The sweep is the opposite
 * shape: one task at a time, a verdict in a couple of seconds, progress you
 * can watch move.
 */
import { appDayKey } from './time';
import { sortLists } from './listOrder';
import type { List, Task } from './types';

/**
 * The queue, in the order a human wants to review: list by list (matching the
 * home screen's order — ungrouped first, then groups alphabetically, manual
 * order within), oldest task first within each list. Grouping by list keeps
 * one context in your head at a time; oldest-first puts the most-likely-stale
 * decisions where the momentum is freshest.
 */
export function sweepQueue(tasks: Task[], lists: List[]): Task[] {
  const pending = tasks.filter(
    (t) => !t.deleted && t.completedAt === undefined && t.needsReview === true,
  );
  return orderByHomeLists(pending, lists);
}

/**
 * The estimate check (2026-07-29 request): already-triaged tasks whose
 * estimate is still the silent 1-hour assumption. One tap confirms the hour
 * (writing an EXPLICIT 1, which is what removes it from this queue), or type
 * what it will really take. Deadline escalation and the burden stats both run
 * on estimates, so confirmed numbers make the whole app more honest.
 */
export function estimateQueue(tasks: Task[], lists: List[]): Task[] {
  const pending = tasks.filter(
    (t) =>
      !t.deleted &&
      t.completedAt === undefined &&
      t.needsReview !== true &&
      t.estimateHours === undefined,
  );
  return orderByHomeLists(pending, lists);
}

/** Shared ordering for every sweep flavour — see sweepQueue's doc comment. */
function orderByHomeLists(pending: Task[], lists: List[]): Task[] {
  const byList = new Map<string, Task[]>();
  for (const t of pending) {
    const bucket = byList.get(t.listId) ?? [];
    bucket.push(t);
    byList.set(t.listId, bucket);
  }
  for (const bucket of byList.values()) bucket.sort((a, b) => a.createdAt - b.createdAt);

  // Home-screen list order: '' group first, then groups alphabetically.
  // Archived lists are skipped entirely — archiving IS the verdict on them.
  const groups = new Map<string, List[]>();
  for (const l of lists.filter((x) => !x.deleted && x.archived !== true)) {
    const key = l.areaGroup?.trim() ?? '';
    const bucket = groups.get(key) ?? [];
    bucket.push(l);
    groups.set(key, bucket);
  }
  const orderedLists = [...groups.entries()]
    .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)))
    .flatMap(([, ls]) => sortLists(ls));

  const out: Task[] = [];
  for (const l of orderedLists) out.push(...(byList.get(l.id) ?? []));
  // Tasks on unknown lists (sync edge) still deserve review — last, not lost.
  // (Archived lists are KNOWN, so their tasks fall out here rather than back in.)
  const known = new Set(lists.filter((x) => !x.deleted).map((l) => l.id));
  for (const [listId, bucket] of byList) if (!known.has(listId)) out.push(...bucket);
  return out;
}

/** The five things a sweep can decide about a task. */
export type SweepVerdict = 'keep' | 'someday' | 'later' | 'done' | 'delete';

/**
 * Timestamp for "snooze until this many days from now": the task re-enters the
 * randomizer at that day's rollover hour, exactly like Not Today does for one
 * day. Built on the same field, so the draw needs no new rules at all.
 */
export function snoozeUntilTs(daysFromNow: number, rolloverHour: number, now: Date): number {
  const target = new Date(now.getFullYear(), now.getMonth(), now.getDate() + daysFromNow, rolloverHour, 0, 0, 0);
  return target.getTime();
}

/** Snooze presets the sweep offers — enough range without a date-picker detour. */
export const SNOOZE_PRESETS: ReadonlyArray<{ label: string; days: number }> = [
  { label: 'a week', days: 7 },
  { label: 'a month', days: 30 },
  { label: '3 months', days: 91 },
];

/**
 * Is this snooze LONGER than a plain "not today"? Those deserve a visible
 * marker on the row — a task quietly asleep for three months should say so.
 */
export function isLongSnooze(task: Task, now: Date, rolloverHour: number): boolean {
  if (task.notTodayUntil === undefined || task.notTodayUntil <= now.getTime()) return false;
  // Key the instant BEFORE the wake: a plain Not Today wakes exactly at
  // tomorrow's rollover, and that instant already belongs to tomorrow — the
  // last covered moment is what says how much of the calendar the snooze eats.
  return appDayKey(new Date(task.notTodayUntil - 1), rolloverHour) > appDayKey(now, rolloverHour);
}
