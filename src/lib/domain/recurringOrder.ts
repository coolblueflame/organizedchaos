/**
 * How the Recurring screen arranges its rules (2026-08-30 ask).
 *
 * Pure, and always answers in GROUPS so the screen renders one shape
 * whatever the mode: the ungrouped orders return a single nameless group.
 * The default matters more here than on most screens — before this the
 * rules appeared in storage order, which is to say the order their random
 * ids happened to land in.
 */
import { pickerListGroups } from './listOrder';
import type { List, RecurrenceTemplate } from './types';

export type RecurringSort = 'list' | 'alpha' | 'next' | 'kept';

export const RECURRING_SORT_LABELS: Record<RecurringSort, string> = {
  list: 'by list',
  alpha: 'a–z',
  next: 'next up',
  kept: 'most kept',
};

export const RECURRING_SORT_CYCLE: RecurringSort[] = ['list', 'alpha', 'next', 'kept'];

export interface RecurringGroup { group: string; templates: RecurrenceTemplate[] }

/** "item 2" before "item 10", and case is not a ranking. */
const byName = (a: RecurrenceTemplate, b: RecurrenceTemplate) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true });

/**
 * Soonest first, with anything unarmed last: a paused rule and an
 * after-completion rule waiting on its open copy both have no next moment,
 * and neither is "due before" a rule that does.
 */
const byNext = (a: RecurrenceTemplate, b: RecurrenceTemplate) => {
  if (a.nextSpawnAt === b.nextSpawnAt) return byName(a, b);
  if (a.nextSpawnAt === undefined) return 1;
  if (b.nextSpawnAt === undefined) return -1;
  return a.nextSpawnAt - b.nextSpawnAt;
};

/** Most faithfully kept first; never-completed rules sort as zero. */
const byKept = (a: RecurrenceTemplate, b: RecurrenceTemplate) =>
  (b.completedInstances ?? 0) - (a.completedInstances ?? 0) || byName(a, b);

export function groupRecurring(
  templates: RecurrenceTemplate[],
  sort: RecurringSort,
  lists: List[],
): RecurringGroup[] {
  if (sort !== 'list') {
    const cmp = sort === 'alpha' ? byName : sort === 'next' ? byNext : byKept;
    return [{ group: '', templates: [...templates].sort(cmp) }];
  }

  // Home order, headers and all — the same arrangement the move-to pickers
  // use, so "where is it?" has one answer across the app.
  const order = pickerListGroups(lists).flatMap((g) => g.lists);
  const groups: RecurringGroup[] = [];
  for (const list of order) {
    const mine = templates.filter((t) => t.listId === list.id).sort(byName);
    if (mine.length > 0) groups.push({ group: list.title, templates: mine });
  }
  // A rule whose list is archived or gone still has to appear somewhere; it
  // would otherwise vanish from the only screen that can edit or delete it.
  const placed = new Set(groups.flatMap((g) => g.templates.map((t) => t.id)));
  const orphans = templates.filter((t) => !placed.has(t.id)).sort(byName);
  if (orphans.length > 0) groups.push({ group: 'elsewhere', templates: orphans });
  return groups;
}
