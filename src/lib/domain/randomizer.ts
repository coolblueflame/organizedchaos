/**
 * The randomizer draw (spec §4) — the heart of the app.
 *
 * Draw = take everything eligible, keep only the highest effective-priority
 * tier, prefer tasks already in progress, then pick uniformly at random.
 * The rng is injected so tests are deterministic and the UI can add drama.
 */
import { drawPriority, effectivePriority } from './priority';
import { priorityRank, type Priority, type Settings, type Task } from './types';

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

/**
 * How much likelier an already-started task is to be drawn than an untouched
 * one in the same tier. Weighted rather than absolute so a long-running task
 * can't monopolise the draw forever — you still get variety, you just get
 * nudged hard toward finishing what you started.
 */
export const IN_PROGRESS_WEIGHT = 5;

export function drawTask(
  tasks: Task[],
  settings: Settings,
  now: Date,
  rng: () => number,
  scope?: DrawScope,
  /** Per-list pressure from project deadlines (see domain/project.ts). */
  projectTiers?: Map<string, Priority>,
): Task | null {
  const pool = eligibleForDraw(tasks, now, scope);
  if (pool.length === 0) return null;

  const tierOf = (t: Task) =>
    priorityRank(drawPriority(t, settings, now, projectTiers?.get(t.listId)));
  const topRank = Math.max(...pool.map(tierOf));
  const tier = pool.filter((t) => tierOf(t) === topRank);

  // Tasks that reached this tier on their own merit go before ones a project
  // deadline lifted here — finishing those shrinks the project's estimate and
  // relieves the pressure naturally.
  const intrinsic = tier.filter(
    (t) => priorityRank(effectivePriority(t, settings, now)) === topRank,
  );
  const candidates = intrinsic.length > 0 ? intrinsic : tier;

  const weightOf = (t: Task) => (t.inProgress ? IN_PROGRESS_WEIGHT : 1);
  const total = candidates.reduce((sum, t) => sum + weightOf(t), 0);
  let roll = rng() * total;
  for (const task of candidates) {
    roll -= weightOf(task);
    if (roll <= 0) return task;
  }
  return candidates[candidates.length - 1] ?? null;
}
