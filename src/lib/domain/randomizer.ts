/**
 * The randomizer draw (spec §4) — the heart of the app.
 *
 * Draw = take everything eligible, keep only the highest effective-priority
 * tier, prefer tasks already in progress, then pick uniformly at random.
 * The rng is injected so tests are deterministic and the UI can add drama.
 */
import { effectivePriority } from './priority';
import { priorityRank, type Settings, type Task } from './types';

export interface DrawScope {
  /**
   * Include-list of list ids (the UI's "all lists minus the omitted ones").
   * undefined = every list; an empty array legitimately matches nothing.
   */
  listIds?: string[];
  /** Tag filter: a task matches if it carries ANY selected tag. Empty = unrestricted. */
  tagIds?: string[];
  /** Session-only "Not Now" skips — guarantees re-rolls surface a different task. */
  excludeIds?: string[];
}

/**
 * Who's in the pool. "Not Today" (notTodayUntil) affects ONLY this — snoozed
 * tasks remain fully visible in lists, sort views, and In Progress (spec §4).
 */
export function eligibleForDraw(tasks: Task[], now: Date, scope?: DrawScope): Task[] {
  const ts = now.getTime();
  const listFilter = scope?.listIds !== undefined ? new Set(scope.listIds) : null;
  const tagFilter = scope?.tagIds?.length ? new Set(scope.tagIds) : null;
  const excluded = scope?.excludeIds?.length ? new Set(scope.excludeIds) : null;
  return tasks.filter(
    (t) =>
      !t.deleted &&
      t.completedAt === undefined &&
      (t.notTodayUntil === undefined || t.notTodayUntil <= ts) &&
      (listFilter === null || listFilter.has(t.listId)) &&
      (tagFilter === null || t.tagIds.some((id) => tagFilter.has(id))) &&
      (excluded === null || !excluded.has(t.id)),
  );
}

export function drawTask(
  tasks: Task[],
  settings: Settings,
  now: Date,
  rng: () => number,
  scope?: DrawScope,
): Task | null {
  const pool = eligibleForDraw(tasks, now, scope);
  if (pool.length === 0) return null;
  const topRank = Math.max(...pool.map((t) => priorityRank(effectivePriority(t, settings, now))));
  const tier = pool.filter((t) => priorityRank(effectivePriority(t, settings, now)) === topRank);
  const started = tier.filter((t) => t.inProgress);
  const candidates = started.length > 0 ? started : tier;
  return candidates[Math.floor(rng() * candidates.length)] ?? null;
}
