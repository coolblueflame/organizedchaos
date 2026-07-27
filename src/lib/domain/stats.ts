/**
 * Completion counters, chart series, and the backlog-burden reconstruction
 * (spec §6 stats screen). All day math rides the 4am app-day rule; the burden
 * series is computed retroactively from createdAt/completedAt and tombstone
 * updatedAt (a tombstone's last write IS its deletion moment), so imported
 * Things history graphs correctly from day one.
 */
import { addDaysKey, appDayKey } from './time';
import type { Task } from './types';

const doneTasks = (tasks: Task[]) =>
  tasks.filter((t) => !t.deleted && t.completedAt !== undefined);

/** Counters only credit work finished IN this app, not imported history. */
const scoredTasks = (tasks: Task[]) => doneTasks(tasks).filter((t) => !t.importedHistory);

/** Monday-first start of the ISO week containing the given day key. */
function weekStartKey(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  const date = new Date(y!, m! - 1, d!, 12);
  const dow = (date.getDay() + 6) % 7; // Monday = 0
  return addDaysKey(dayKey, -dow);
}

/**
 * Everything finished during one app-day, oldest first — the order you did
 * them in, which is the order you'd recount them in.
 *
 * Imported history is excluded: a Things backup dumped in this morning is not
 * something you accomplished today, and it would swamp a real day's list.
 */
export function completedOnDay(tasks: Task[], dayKey: string, rolloverHour: number): Task[] {
  return scoredTasks(tasks)
    .filter((t) => appDayKey(new Date(t.completedAt!), rolloverHour) === dayKey)
    .sort((a, b) => a.completedAt! - b.completedAt!);
}

/**
 * Today's finished work as a plain dash-bulleted list, for pasting somewhere
 * that deserves to hear about it.
 *
 * A literal "- " rather than a typographic bullet on purpose: it survives
 * every editor, chat box and issue tracker unchanged, and Markdown renders it
 * as a real list. Unnamed tasks still get a line — a blank bullet is a better
 * prompt than a silently shorter list.
 */
export function winsList(tasks: Task[], now: Date, rolloverHour: number): string {
  const day = appDayKey(now, rolloverHour);
  return completedOnDay(tasks, day, rolloverHour)
    .map((t) => `- ${t.name.trim() || 'untitled'}`)
    .join('\n');
}

export interface CompletionCounts {
  today: number; week: number; month: number; year: number; lifetime: number;
}

export function completionCounts(tasks: Task[], now: Date, rolloverHour: number): CompletionCounts {
  const todayKey = appDayKey(now, rolloverHour);
  const thisWeek = weekStartKey(todayKey);
  const thisMonth = todayKey.slice(0, 7);
  const thisYear = todayKey.slice(0, 4);
  const counts: CompletionCounts = { today: 0, week: 0, month: 0, year: 0, lifetime: 0 };
  for (const t of scoredTasks(tasks)) {
    const key = appDayKey(new Date(t.completedAt!), rolloverHour);
    counts.lifetime += 1;
    if (key === todayKey) counts.today += 1;
    if (weekStartKey(key) === thisWeek) counts.week += 1;
    if (key.slice(0, 7) === thisMonth) counts.month += 1;
    if (key.slice(0, 4) === thisYear) counts.year += 1;
  }
  return counts;
}

export interface SeriesPoint { key: string; label: string; count: number }

export function completionSeries(
  tasks: Task[],
  granularity: 'day' | 'week' | 'month',
  bucketCount: number,
  now: Date,
  rolloverHour: number,
): SeriesPoint[] {
  const todayKey = appDayKey(now, rolloverHour);
  const bucketOf = (dayKey: string): string =>
    granularity === 'day' ? dayKey :
    granularity === 'week' ? weekStartKey(dayKey) :
    dayKey.slice(0, 7);

  // Build the bucket keys newest→oldest, then reverse.
  const keys: string[] = [];
  let cursor = granularity === 'month' ? `${todayKey.slice(0, 7)}-15` : todayKey;
  for (let i = 0; i < bucketCount; i++) {
    keys.push(bucketOf(cursor));
    cursor = granularity === 'day' ? addDaysKey(cursor, -1) :
      granularity === 'week' ? addDaysKey(cursor, -7) :
      addDaysKey(`${cursor.slice(0, 7)}-01`, -1); // hop into the previous month
  }
  keys.reverse();

  const counts = new Map<string, number>(keys.map((k) => [k, 0]));
  for (const t of doneTasks(tasks)) {
    const bucket = bucketOf(appDayKey(new Date(t.completedAt!), rolloverHour));
    if (counts.has(bucket)) counts.set(bucket, counts.get(bucket)! + 1);
  }
  const label = (k: string): string =>
    granularity === 'month' ? k.slice(2, 7) :
    granularity === 'week' ? `wk ${k.slice(5)}` :
    k.slice(5);
  return keys.map((k) => ({ key: k, label: label(k), count: counts.get(k) ?? 0 }));
}

/** Open-backlog hours: estimate ?? 1 per open, live task. */
export function totalEstimateHours(tasks: Task[]): number {
  return tasks
    .filter((t) => !t.deleted && t.completedAt === undefined)
    .reduce((sum, t) => sum + (t.estimateHours ?? 1), 0);
}

const DURATION_UNITS: Array<[string, number]> = [
  ['y', 24 * 365], ['mo', 24 * 30], ['w', 24 * 7], ['d', 24], ['h', 1],
];

/** Literal duration, two most-significant units: 26 → "1d 2h". */
export function formatDuration(hours: number): string {
  if (hours <= 0) return '0h';
  const parts: string[] = [];
  let rest = Math.round(hours);
  for (const [suffix, size] of DURATION_UNITS) {
    if (parts.length === 2) break;
    const amount = Math.floor(rest / size);
    if (amount > 0 || (parts.length > 0 && suffix === 'h' && rest > 0)) {
      if (amount > 0) parts.push(`${amount}${suffix}`);
      rest -= amount * size;
    }
  }
  return parts.length ? parts.join(' ') : '0h';
}

/**
 * Tracked working time for a finished task — only present when it was
 * completed while actually in progress (see Task.activeMs).
 */
export function activeMs(task: Task): number | null {
  return task.activeMs && task.activeMs > 0 ? task.activeMs : null;
}

/** Live elapsed time including the stretch currently running. */
export function elapsedSoFar(task: Task, now = Date.now()): number {
  const banked = task.activeAccumulatedMs ?? 0;
  return task.startedAt ? banked + (now - task.startedAt) : banked;
}

/** Mean time-to-finish across everything that was timed. Null until there's data. */
export function averageActiveMs(tasks: Task[]): number | null {
  const timed = tasks
    .filter((t) => !t.deleted && !t.importedHistory && t.completedAt !== undefined)
    .map(activeMs)
    .filter((ms): ms is number => ms !== null);
  if (timed.length === 0) return null;
  return Math.round(timed.reduce((a, b) => a + b, 0) / timed.length);
}

/** "2h 5m" / "45m" / "30s" — short human duration for elapsed times. */
export function formatElapsed(ms: number): string {
  const totalMinutes = Math.round(ms / 60_000);
  if (totalMinutes < 1) return `${Math.max(1, Math.round(ms / 1000))}s`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes}m`;
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

export interface BurdenPoint { key: string; hours: number }

/**
 * Backlog burden per sampled app-day. Uses CURRENT estimates (edit history
 * isn't tracked — documented approximation, spec §6).
 */
export function burdenSeries(
  tasks: Task[],
  sampleDays: number,
  now: Date,
  rolloverHour: number,
): BurdenPoint[] {
  const todayKey = appDayKey(now, rolloverHour);
  const keys: string[] = [];
  for (let i = sampleDays - 1; i >= 0; i--) keys.push(addDaysKey(todayKey, -i));

  return keys.map((key) => {
    // End of app-day `key` = rollover moment of the NEXT calendar day.
    const [y, m, d] = addDaysKey(key, 1).split('-').map(Number);
    const end = new Date(y!, m! - 1, d!, rolloverHour).getTime();
    let hours = 0;
    for (const t of tasks) {
      if (t.createdAt > end) continue;
      if (t.completedAt !== undefined && t.completedAt <= end) continue;
      if (t.deleted && t.updatedAt <= end) continue;
      hours += t.estimateHours ?? 1;
    }
    return { key, hours };
  });
}
