/**
 * The day queue (2026-07-29 request): a hand-ordered plan for days where a
 * specific order makes sense. The user queues tasks in the morning, drags them
 * into order, and the randomizer serves the queue top first whenever it can.
 *
 * Stored as an ordered list of task ids in a synced kv singleton (newest-wins
 * by stamp, like settings). Ids whose tasks complete or disappear simply stop
 * resolving — the same inert-dangling-reference rule tags use — so finishing
 * work IS how the queue drains.
 */
import type { Task } from './types';

/** The queue as the user sees it: ids that still point at live, open tasks. */
export function liveQueueIds(ids: string[], tasks: Task[]): string[] {
  const open = new Set<string>();
  for (const t of tasks) {
    if (!t.deleted && t.completedAt === undefined) open.add(t.id);
  }
  return ids.filter((id) => open.has(id));
}

/** Snoozed for the day ("not today") as of `nowMs`: out of the draw until the rollover. */
export function snoozedForDay(t: Task, nowMs: number): boolean {
  return t.notTodayUntil !== undefined && t.notTodayUntil > nowMs;
}

/**
 * The queue as it should READ: what can still be drawn today first, in
 * queue order, then what has been snoozed, in queue order. The stored order
 * is untouched — a snooze lasts until the rollover, and when it lifts the
 * task is simply back in its own place. (2026-09-07 ask: a "not today" on a
 * queued task left the queue looking as if nothing had happened.)
 */
export function displayQueue(queued: Task[], nowMs: number): { active: Task[]; snoozed: Task[] } {
  return {
    active: queued.filter((t) => !snoozedForDay(t, nowMs)),
    snoozed: queued.filter((t) => snoozedForDay(t, nowMs)),
  };
}

/**
 * A hand-reorder of the draggable rows, folded back into the stored order
 * so every other id keeps its own index. The snoozed rows are shown at the
 * bottom but were never moved, and rows hidden behind the lock are not shown
 * at all; dragging the rest around must not quietly move either. `active`
 * is the new order of exactly the ids that were draggable.
 */
export function mergeReorder(stored: string[], active: string[]): string[] {
  const draggable = new Set(active);
  let next = 0;
  return stored.map((id) => (draggable.has(id) ? active[next++]! : id));
}
