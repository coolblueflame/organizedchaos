/**
 * Dropping a task on a group header adopts that group's defining attribute:
 * priority view → set priority, tag view → add that tag, date view → set the
 * deadline. Pure, so the drag UI stays a thin shell over a tested rule.
 */
import { PRIORITIES, type Priority, type Task } from './types';

export interface RegroupPatch {
  patch: Partial<Task>;
  /** Short past-tense description for the undo toast / announcement. */
  describe: string;
}

/**
 * What should change when `task` is dropped into `groupKey` of a given view.
 * Returns null when the drop is a no-op or meaningless (e.g. the "Overdue"
 * bucket, which isn't a date you can assign).
 */
export function regroupPatch(
  task: Task,
  mode: 'priority' | 'tag' | 'date',
  groupKey: string,
  tagName?: string,
): RegroupPatch | null {
  if (mode === 'priority') {
    if (!PRIORITIES.includes(groupKey as Priority)) return null;
    const priority = groupKey as Priority;
    if (task.priority === priority) return null;
    return { patch: { priority }, describe: `set to ${priority}` };
  }

  if (mode === 'tag') {
    if (groupKey === 'untagged') {
      if (task.tagIds.length === 0) return null;
      return { patch: { tagIds: [] }, describe: 'cleared its tags' };
    }
    if (task.tagIds.includes(groupKey)) return null;
    return {
      patch: { tagIds: [...task.tagIds, groupKey] },
      describe: `tagged ${tagName ?? 'it'}`,
    };
  }

  // date view
  if (groupKey === 'none') {
    if (task.deadline === undefined) return null;
    return { patch: { deadline: undefined }, describe: 'deadline removed' };
  }
  // 'overdue' is a computed bucket, not an assignable date
  if (!/^\d{4}-\d{2}-\d{2}$/.test(groupKey)) return null;
  if (task.deadline === groupKey) return null;
  return { patch: { deadline: groupKey }, describe: `due ${groupKey}` };
}
