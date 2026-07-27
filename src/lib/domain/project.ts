/**
 * Project-level deadline escalation (2026-07-27 request).
 *
 * A list can carry its own completion date. Rather than judging each task by
 * its own estimate, the whole list is judged by the SUM of its open tasks'
 * estimates: if there isn't enough runway left to finish everything, every
 * task in the list climbs the tiers together.
 *
 * Ranking nuance: a task lifted this way can reach max, but tasks that are
 * max in their own right still get drawn first — knocking a few off shrinks
 * the project's remaining estimate, which relaxes the pressure naturally.
 */
import { derivedPriority } from './priority';
import type { List, Priority, Settings, Task } from './types';

/** Hours of work left in a list: open, live tasks, estimate ?? 1 each. */
export function remainingEstimateHours(tasks: Task[], listId: string): number {
  return tasks
    .filter((t) => t.listId === listId && !t.deleted && t.completedAt === undefined)
    .reduce((sum, t) => sum + (t.estimateHours ?? 1), 0);
}

/**
 * The tier a list's deadline currently imposes on its tasks, or null when the
 * list has no deadline (or nothing left to do). Reuses the single-task slack
 * bands so the two escalations behave identically — only the estimate differs.
 */
export function projectPriority(
  list: List,
  tasks: Task[],
  settings: Settings,
  now: Date,
): Priority | null {
  if (!list.deadline) return null;
  const hours = remainingEstimateHours(tasks, list.id);
  if (hours <= 0) return null;
  return derivedPriority({ deadline: list.deadline, estimateHours: hours }, settings, now);
}

/** Every list's current project tier, keyed by list id (absent = no pressure). */
export function projectPriorities(
  lists: List[],
  tasks: Task[],
  settings: Settings,
  now: Date,
): Map<string, Priority> {
  const map = new Map<string, Priority>();
  for (const list of lists) {
    const p = projectPriority(list, tasks, settings, now);
    if (p) map.set(list.id, p);
  }
  return map;
}
