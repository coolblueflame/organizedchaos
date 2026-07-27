/**
 * Grouping/sorting logic behind every task view (spec §6). Pure functions so the
 * three global sort views, list views, and the completed screen stay dumb.
 */
import { effectivePriority } from './priority';
import { appDayKey, daysUntilDeadline } from './time';
import { PRIORITIES, priorityRank, type Priority, type Settings, type Tag, type Task } from './types';

export interface TaskGroup { key: string; label: string; tasks: Task[] }

/** How tasks are ordered WITHIN a group (the group order itself is fixed). */
export type SubSort = 'smart' | 'alpha' | 'created' | 'newest';

export const SUB_SORT_LABELS: Record<SubSort, string> = {
  smart: 'smart',
  alpha: 'a–z',
  created: 'oldest',
  newest: 'newest',
};

/**
 * Applies the chosen within-group order. 'smart' keeps whatever the grouper
 * decided (priority/deadline-aware), which is the default everywhere.
 */
export function applySubSort(tasks: Task[], sub: SubSort): Task[] {
  if (sub === 'smart') return tasks;
  const sorted = [...tasks];
  if (sub === 'alpha') {
    sorted.sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  } else if (sub === 'created') {
    sorted.sort((a, b) => a.createdAt - b.createdAt);
  } else {
    sorted.sort((a, b) => b.createdAt - a.createdAt);
  }
  return sorted;
}

export function subSortGroups(groups: TaskGroup[], sub: SubSort): TaskGroup[] {
  if (sub === 'smart') return groups;
  return groups.map((g) => ({ ...g, tasks: applySubSort(g.tasks, sub) }));
}

/** Open (not completed) tasks only — the input every list/sort view starts from. */
export function openTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.deleted && t.completedAt === undefined);
}

const byEffectiveDesc = (settings: Settings, now: Date) => (a: Task, b: Task) =>
  priorityRank(effectivePriority(b, settings, now)) - priorityRank(effectivePriority(a, settings, now));

/** Deadline ascending, deadline-less last. */
const byDeadlineAsc = (a: Task, b: Task) => {
  if (a.deadline === b.deadline) return 0;
  if (a.deadline === undefined) return 1;
  if (b.deadline === undefined) return -1;
  return a.deadline < b.deadline ? -1 : 1;
};

/** Overdue → per-date ascending → 'No deadline' last; sub-sorted by effective priority desc. */
export function groupByDate(tasks: Task[], settings: Settings, now: Date): TaskGroup[] {
  const open = openTasks(tasks);
  const overdue: Task[] = [];
  const dated = new Map<string, Task[]>();
  const none: Task[] = [];
  for (const t of open) {
    if (t.deadline === undefined) { none.push(t); continue; }
    if (daysUntilDeadline(t.deadline, now, settings.rolloverHour) < 0) { overdue.push(t); continue; }
    const bucket = dated.get(t.deadline) ?? [];
    bucket.push(t);
    dated.set(t.deadline, bucket);
  }
  const sub = byEffectiveDesc(settings, now);
  const groups: TaskGroup[] = [];
  if (overdue.length) groups.push({ key: 'overdue', label: 'Overdue', tasks: overdue.sort(sub) });
  for (const key of [...dated.keys()].sort()) {
    groups.push({ key, label: key, tasks: dated.get(key)!.sort(sub) });
  }
  if (none.length) groups.push({ key: 'none', label: 'No deadline', tasks: none.sort(sub) });
  return groups;
}

const PRIORITY_LABELS: Record<Priority, string> =
  { someday: 'Someday', low: 'Low', medium: 'Medium', high: 'High', max: 'Max' };

/** Max → … → Someday by EFFECTIVE priority; sub-sorted by deadline asc, deadline-less last. */
export function groupByPriority(tasks: Task[], settings: Settings, now: Date): TaskGroup[] {
  const open = openTasks(tasks);
  const groups: TaskGroup[] = [];
  for (const p of [...PRIORITIES].reverse()) {
    const bucket = open.filter((t) => effectivePriority(t, settings, now) === p).sort(byDeadlineAsc);
    if (bucket.length) groups.push({ key: p, label: PRIORITY_LABELS[p], tasks: bucket });
  }
  return groups;
}

/**
 * Alphabetical tag sections — multi-tag tasks appear in EVERY matching section
 * (spec §6) — with 'Untagged' last; sub-sorted by effective priority desc.
 */
export function groupByTag(tasks: Task[], tags: Tag[], settings: Settings, now: Date): TaskGroup[] {
  const open = openTasks(tasks);
  const sub = byEffectiveDesc(settings, now);
  const liveTags = tags.filter((t) => !t.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const groups: TaskGroup[] = [];
  for (const tg of liveTags) {
    const bucket = open.filter((t) => t.tagIds.includes(tg.id)).sort(sub);
    if (bucket.length) groups.push({ key: tg.id, label: tg.name, tasks: bucket });
  }
  const untagged = open.filter((t) => t.tagIds.length === 0).sort(sub);
  if (untagged.length) groups.push({ key: 'untagged', label: 'Untagged', tasks: untagged });
  return groups;
}

/** Completed tasks bucketed by completion app-day (4am rule), newest day + completion first. */
export function groupCompleted(tasks: Task[], rolloverHour: number): TaskGroup[] {
  const done = tasks
    .filter((t) => !t.deleted && t.completedAt !== undefined)
    .sort((a, b) => b.completedAt! - a.completedAt!);
  const buckets = new Map<string, Task[]>();
  for (const t of done) {
    const key = appDayKey(new Date(t.completedAt!), rolloverHour);
    const bucket = buckets.get(key) ?? [];
    bucket.push(t);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, ts]) => ({ key, label: key, tasks: ts }));
}
