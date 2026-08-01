/**
 * Locked lists (2026-08-01 ask): sensitive lists sit behind a PIN. While the
 * app is locked their contents neither render nor draw — home shows the list
 * as a locked row, and every surface that lists TASKS filters them the same
 * way archive.ts filters archived ones. Unlocking is per-session.
 *
 * Honesty note (told to Ben): this is a privacy screen against shoulder
 * surfing and borrowed phones, NOT encryption. The tasks are stored and
 * synced exactly like everything else.
 */
import type { List, Task } from './types';

export function lockedListIds(lists: List[], unlocked: boolean): Set<string> {
  if (unlocked) return new Set();
  return new Set(lists.filter((l) => !l.deleted && l.locked === true).map((l) => l.id));
}

/** Open-task ids the randomizer must exclude while locked. */
export function lockedTaskIds(tasks: Task[], lists: List[], unlocked: boolean): string[] {
  const locked = lockedListIds(lists, unlocked);
  if (locked.size === 0) return [];
  return tasks
    .filter((t) => !t.deleted && t.completedAt === undefined && locked.has(t.listId))
    .map((t) => t.id);
}

/** Every task view's filter — unlike archive this hides COMPLETED ones too:
    a finished "update the résumé" is exactly as telling as an open one. */
export function withoutLocked(tasks: Task[], lists: List[], unlocked: boolean): Task[] {
  const locked = lockedListIds(lists, unlocked);
  if (locked.size === 0) return tasks;
  return tasks.filter((t) => !locked.has(t.listId));
}
