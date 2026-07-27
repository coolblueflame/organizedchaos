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

  // Each blocked task's own urgency, computed once rather than per pass.
  const ownRank = new Map<string, number>();
  for (const list of waiting.values()) {
    for (const t of list) {
      if (!ownRank.has(t.id)) ownRank.set(t.id, priorityRank(effectivePriority(t, settings, now)));
    }
  }

  /**
   * Solved by raising every blocker's demand until nothing moves, rather than
   * by walking the graph depth-first.
   *
   * Depth-first needs a cycle rule, and every cheap rule is wrong: cutting the
   * revisited edge yields an answer that depends on which node happened to be
   * visited first, and caching those answers hands a healthy task a lift lower
   * than the work genuinely waiting on it. Not caching them is correct but
   * exponential — a dozen mutually-blocking tasks took minutes, and this runs
   * inside a $derived, so that is a frozen app.
   *
   * Relaxation has neither problem. Values only ever rise, so this settles on
   * the same answer regardless of order, cycles need no special case at all
   * (a deadlocked group simply converges on the strongest priority trapped in
   * it), and a pass that changes nothing ends it — normally the second one.
   */
  const lift = new Map<string, number>();
  const passLimit = waiting.size + 1; // longest chain it could need; usually 2
  for (let pass = 0; pass < passLimit; pass += 1) {
    let changed = false;
    for (const [blockerId, blockedTasks] of waiting) {
      const current = lift.get(blockerId) ?? -1;
      let best = current;
      for (const blocked of blockedTasks) {
        // What this blocker owes: the waiting task's own urgency, or whatever
        // that task is itself holding up, whichever is stronger.
        const demand = Math.max(ownRank.get(blocked.id) ?? -1, lift.get(blocked.id) ?? -1);
        if (demand > best) best = demand;
      }
      if (best > current) {
        lift.set(blockerId, best);
        changed = true;
      }
    }
    if (!changed) break;
  }

  const byId = new Map(tasks.map((t) => [t.id, t]));
  const lifts = new Map<string, Priority>();
  for (const [blockerId, rank] of lift) {
    const blocker = byId.get(blockerId);
    if (!blocker || isDone(blocker)) continue; // finished blockers need no help
    if (rank >= 0) lifts.set(blockerId, PRIORITIES[rank]!);
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
