/**
 * Archived lists: cruft you are done thinking about but not willing to delete.
 *
 * One rule, applied everywhere the app PROPOSES work: an archived list's tasks
 * never surface on their own — not on home, not from the dice, not in the
 * sweep, not in the sort views. They remain fully reachable when you go
 * looking: search still finds them, completed history still counts them, and
 * the list itself opens normally from the archived shelf.
 */
import type { List, Task } from './types';

export function archivedListIds(lists: List[]): Set<string> {
  return new Set(lists.filter((l) => !l.deleted && l.archived === true).map((l) => l.id));
}

/** Open-task ids the randomizer must exclude. */
export function archivedTaskIds(tasks: Task[], lists: List[]): string[] {
  const archived = archivedListIds(lists);
  if (archived.size === 0) return [];
  return tasks
    .filter((t) => !t.deleted && t.completedAt === undefined && archived.has(t.listId))
    .map((t) => t.id);
}

/** Tasks with the archived lists' contents removed — what the sort views show. */
export function withoutArchived(tasks: Task[], lists: List[]): Task[] {
  const archived = archivedListIds(lists);
  if (archived.size === 0) return tasks;
  return tasks.filter((t) => !archived.has(t.listId));
}
