/**
 * The randomizer draw (spec §4) — the heart of the app.
 *
 * Draw = take everything eligible, keep only the highest effective-priority
 * tier, prefer tasks already in progress, then pick uniformly at random.
 * The rng is injected so tests are deterministic and the UI can add drama.
 */
import { drawPriority, effectivePriority } from './priority';
import { isBlocked } from './blocking';
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
  /**
   * Work-period fit: only offer tasks estimated to fit in the time left.
   * MAX-priority work is exempt — an emergency doesn't care about your window.
   */
  maxEstimateHours?: number;
  /**
   * Diagnostic only: keep tasks whose blockers are unfinished. The UI uses
   * this to tell "there is nothing left" apart from "everything left is
   * waiting on something else" — never to actually draw one.
   */
  includeBlocked?: boolean;
  /**
   * The hand-ordered day queue: the FIRST of these ids still in the pool is
   * served instead of a random pick. A deliberately planned order outranks any
   * priority tier — but only the ORDER is privileged: snoozes, blockers, list
   * hours, filters and the work-period fit all still gate the pool, so a
   * queued task the rules would hide falls through to the next one (and then
   * to the normal draw).
   */
  queueFirst?: string[];
  /**
   * Owed RIGHT NOW (2026-07-29: due rituals): while any of these ids survive
   * in the pool, the draw serves only from them — above every tier and above
   * the day queue, because a window closes and a queue doesn't. Several owed
   * tasks still draw fairly among themselves (tiering and the in-progress
   * weighting run within the subset).
   */
  dueFirst?: string[];
  /**
   * "Peppered" tasks (2026-08-20 ask): chance-mode recurrences. Rolled AFTER
   * due rituals and the day queue but BEFORE the tiers — each entry hits with
   * its own chancePct (0–100), and a hit serves that task. Peppers are
   * chance-ONLY: they never join the tier pool, so the configured number is
   * their entire probability of appearing… with one honest exception: when
   * peppers are ALL that's eligible, the draw serves one anyway — dice that
   * come up empty while a task is visibly available read as broken, not rare.
   */
  peppers?: Array<{ taskId: string; chancePct: number }>;
}

/**
 * Who's in the pool. "Not Today" (notTodayUntil) and unfinished blockers affect
 * ONLY this — snoozed and blocked tasks remain fully visible in lists, sort
 * views, and In Progress (spec §4).
 */
export function eligibleForDraw(tasks: Task[], now: Date, scope?: DrawScope): Task[] {
  const ts = now.getTime();
  const listFilter = scope?.listIds !== undefined ? new Set(scope.listIds) : null;
  const tagFilter = scope?.tagIds?.length ? new Set(scope.tagIds) : null;
  const excluded = scope?.excludeIds?.length ? new Set(scope.excludeIds) : null;
  // Blockers may live outside the scoped lists, so resolve against everything.
  const index = new Map(tasks.map((t) => [t.id, t]));
  return tasks.filter(
    (t) =>
      !t.deleted &&
      t.completedAt === undefined &&
      (t.notTodayUntil === undefined || t.notTodayUntil <= ts) &&
      (listFilter === null || listFilter.has(t.listId)) &&
      (tagFilter === null || t.tagIds.some((id) => tagFilter.has(id))) &&
      (excluded === null || !excluded.has(t.id)) &&
      (scope?.includeBlocked === true || !isBlocked(t, index)),
  );
}

/**
 * How often the dice reach for work you have ALREADY STARTED, when the
 * winning tier holds both started and untouched tasks.
 *
 * A GROUP-level roll, not a per-task weight (2026-08-24 ask, after the
 * per-task version was measured against a real library). The old rule made
 * one started task five times likelier than one untouched task — which
 * sounds strong until the tier holds 12 started and 824 untouched, where
 * 5:1 per task still comes to about one draw in fifteen. Weighting the
 * CHOICE instead of the tasks makes the promise independent of how lopsided
 * the pile is: four draws in five come from what's already open, however
 * many of each there are. Not 100%, because sometimes the honest answer is
 * that the started pile is stale and something fresh deserves a look.
 */
export const STARTED_FIRST_CHANCE = 0.8;

export function drawTask(
  tasks: Task[],
  settings: Settings,
  now: Date,
  rng: () => number,
  scope?: DrawScope,
  /** Per-list pressure from project deadlines (see domain/project.ts). */
  projectTiers?: Map<string, Priority>,
  /** Per-task pressure from work that is blocked on it (see domain/blocking.ts). */
  lifts?: Map<string, Priority>,
): Task | null {
  let pool = eligibleForDraw(tasks, now, scope);
  if (scope?.maxEstimateHours !== undefined) {
    const fits = scope.maxEstimateHours;
    pool = pool.filter(
      (t) =>
        effectivePriority(t, settings, now) === 'max' || (t.estimateHours ?? 1) <= fits,
    );
  }
  if (pool.length === 0) return null;

  // What's owed right now narrows the whole draw to itself (see DrawScope.dueFirst).
  if (scope?.dueFirst?.length) {
    const due = new Set(scope.dueFirst);
    const owed = pool.filter((t) => due.has(t.id));
    if (owed.length > 0) pool = owed;
  }

  // The day queue pre-empts the tiered draw entirely (see DrawScope.queueFirst).
  if (scope?.queueFirst?.length) {
    const byId = new Map(pool.map((t) => [t.id, t]));
    for (const id of scope.queueFirst) {
      const queued = byId.get(id);
      if (queued) return queued;
    }
  }

  // The pepper roll (see DrawScope.peppers). Each eligible pepper rolls
  // independently; several hits pick uniformly among themselves. Misses fall
  // through to the tiers — WITHOUT the peppers, which are chance-only.
  if (scope?.peppers?.length) {
    const byId = new Map(pool.map((t) => [t.id, t]));
    const eligible = scope.peppers.filter((p) => byId.has(p.taskId));
    const hits = eligible.filter((p) => rng() * 100 < p.chancePct);
    if (hits.length > 0) {
      return byId.get(hits[Math.floor(rng() * hits.length)]!.taskId)!;
    }
    const pepperIds = new Set(scope.peppers.map((p) => p.taskId));
    const rest = pool.filter((t) => !pepperIds.has(t.id));
    if (rest.length === 0) {
      // Nothing but peppers left: serve one rather than an empty screen.
      return eligible.length > 0
        ? byId.get(eligible[Math.floor(rng() * eligible.length)]!.taskId)!
        : null;
    }
    pool = rest;
  }

  const tierOf = (t: Task) =>
    priorityRank(drawPriority(t, settings, now, projectTiers?.get(t.listId), lifts?.get(t.id)));
  const topRank = Math.max(...pool.map(tierOf));
  const tier = pool.filter((t) => tierOf(t) === topRank);

  // Tasks that reached this tier on their own merit go before ones a project
  // deadline lifted here — finishing those shrinks the project's estimate and
  // relieves the pressure naturally. A blocker counts as intrinsic: doing it is
  // the ONLY route to the work waiting behind it, so it competes on equal
  // footing with tasks that are natively this urgent.
  const intrinsic = tier.filter((t) => {
    const own = priorityRank(effectivePriority(t, settings, now));
    const lift = lifts?.get(t.id);
    return Math.max(own, lift ? priorityRank(lift) : 0) === topRank;
  });
  let candidates = intrinsic.length > 0 ? intrinsic : tier;
  /*
    An intrinsic-empty tier is here purely on PROJECT pressure (task-level
    lifts count as intrinsic above), and project pressure is about FINISHING
    the list: started tasks are served ABSOLUTELY first here, not merely
    preferred (2026-07-30 ask) — completing one shrinks the remaining
    estimate; starting another just spreads the work thinner. Ordinary draws
    keep the softer preference below, so no single task owns the dice.
  */
  if (intrinsic.length === 0) {
    const started = candidates.filter((t) => t.inProgress);
    if (started.length > 0) candidates = started;
  }

  /*
    Pick the GROUP first, then a task inside it (see STARTED_FIRST_CHANCE).
    Rolling the group is what keeps the promise honest when the two sides are
    wildly different sizes — the alternative, weighting each started task
    against each untouched one, quietly collapses to nothing in a tier that
    holds hundreds of untouched tasks.
  */
  const started = candidates.filter((t) => t.inProgress);
  const untouched = candidates.filter((t) => !t.inProgress);
  const bucket = started.length > 0 && untouched.length > 0
    ? (rng() < STARTED_FIRST_CHANCE ? started : untouched)
    : candidates;

  const pick = bucket[Math.floor(rng() * bucket.length)];
  // Math.floor(rng() * n) is n only if rng() ever returns exactly 1; fall
  // back rather than hand back undefined.
  return pick ?? bucket[bucket.length - 1] ?? null;
}
