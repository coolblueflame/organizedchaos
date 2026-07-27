/**
 * Task dependencies — "blocked by" (2026-07-27 request).
 *
 * A task can name other tasks that must be finished first. Two consequences,
 * both confined to the randomizer so the lists themselves stay honest:
 *
 *  1. A task with any OPEN blocker is not drawable. It stays fully visible
 *     everywhere else — same contract as "Not Today" (spec §4).
 *  2. A blocker is drawn at the priority of the work it is holding up. If a
 *     Max task waits on a Medium chore, that chore is effectively Max: it is
 *     the thing standing between you and the Max task. This propagates along
 *     the chain, so a blocker-of-a-blocker inherits it too.
 *
 * Only OPEN blocked tasks lift their blockers — finished work demands nothing.
 * The graph is user-authored, so every traversal here is cycle-safe by
 * construction rather than by assuming the data is a DAG.
 */
import { effectivePriority } from './priority';
import { PRIORITIES, priorityRank, type Priority, type Settings, type Task } from './types';

/** A task counts as done — and so stops blocking — when completed or deleted. */
const isDone = (t: Task | undefined): boolean =>
  t === undefined || t.deleted === true || t.completedAt !== undefined;

const byId = (tasks: Task[]): Map<string, Task> => new Map(tasks.map((t) => [t.id, t]));

/** Blockers of `task` that are still outstanding, as ids (missing ones are ignored). */
export function openBlockerIds(task: Task, index: Map<string, Task>): string[] {
  return (task.blockedBy ?? []).filter((id) => !isDone(index.get(id)));
}

/** True when something still has to happen before this task can be started. */
export function isBlocked(task: Task, tasks: Task[] | Map<string, Task>): boolean {
  const index = Array.isArray(tasks) ? byId(tasks) : tasks;
  return openBlockerIds(task, index).length > 0;
}

/**
 * The priority each blocker inherits from the open work waiting on it, keyed by
 * task id. Absent means "nothing is waiting on you" — most tasks.
 *
 * Computed with a memoised depth-first walk up the chain. `demand(x)` is the
 * strongest pull anything downstream of x is exerting; a blocker's lift is the
 * max over each waiting task of (that task's own priority, that task's demand).
 */
export function blockLifts(tasks: Task[], settings: Settings, now: Date): Map<string, Priority> {
  // Who is waiting on whom: blockerId → the open tasks it holds up.
  const waiting = new Map<string, Task[]>();
  for (const t of tasks) {
    if (isDone(t) || !t.blockedBy?.length) continue;
    for (const id of t.blockedBy) {
      const list = waiting.get(id);
      if (list) list.push(t);
      else waiting.set(id, [t]);
    }
  }
  if (waiting.size === 0) return new Map();

  const memo = new Map<string, Priority | null>();
  const onStack = new Set<string>();

  const demand = (taskId: string): Priority | null => {
    const cached = memo.get(taskId);
    if (cached !== undefined) return cached;
    // A cycle can only exist because the user built one; treat the revisited
    // edge as contributing nothing rather than recursing forever.
    if (onStack.has(taskId)) return null;
    onStack.add(taskId);

    let best: Priority | null = null;
    for (const blocked of waiting.get(taskId) ?? []) {
      const own = effectivePriority(blocked, settings, now);
      const inherited = demand(blocked.id);
      const strongest =
        inherited && priorityRank(inherited) > priorityRank(own) ? inherited : own;
      if (best === null || priorityRank(strongest) > priorityRank(best)) best = strongest;
      if (best === PRIORITIES[PRIORITIES.length - 1]) break; // already at the ceiling
    }

    onStack.delete(taskId);
    memo.set(taskId, best);
    return best;
  };

  const lifts = new Map<string, Priority>();
  for (const blockerId of waiting.keys()) {
    const blocker = tasks.find((t) => t.id === blockerId);
    if (!blocker || isDone(blocker)) continue; // finished blockers need no help
    const d = demand(blockerId);
    if (d) lifts.set(blockerId, d);
  }
  return lifts;
}

/**
 * Would making `blockerId` block `taskId` create a loop? True when taskId is
 * already somewhere up blockerId's own chain of blockers — the UI uses this to
 * keep impossible dependencies out of the picker instead of catching them later.
 */
export function wouldCycle(taskId: string, blockerId: string, tasks: Task[]): boolean {
  if (taskId === blockerId) return true;
  const index = byId(tasks);
  const seen = new Set<string>();
  const stack = [blockerId];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (id === taskId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of index.get(id)?.blockedBy ?? []) stack.push(next);
  }
  return false;
}

/**
 * Tasks that `completedId` finishing has just set free — used to tell the user
 * something opened up. Only tasks with no OTHER open blocker qualify.
 */
export function newlyUnblocked(completedId: string, tasks: Task[]): Task[] {
  const index = byId(tasks);
  return tasks.filter(
    (t) =>
      !isDone(t) &&
      (t.blockedBy ?? []).includes(completedId) &&
      openBlockerIds(t, index).length === 0,
  );
}
