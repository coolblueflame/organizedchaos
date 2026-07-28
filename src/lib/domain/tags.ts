/**
 * Tag housekeeping.
 *
 * Importing a real Things library brings every tag it ever had, including ones
 * that differ only in case or stray whitespace. Pruning that needs two things
 * the app could not answer before: which tags are actually carrying weight, and
 * which ones are the same tag twice.
 */
import type { Tag, Task } from './types';

export interface TagUsage {
  /** Open tasks wearing this tag. */
  open: number;
  /** Completed ones — history, so worth knowing before deleting. */
  completed: number;
  total: number;
}

/**
 * How many tasks wear each tag. Tombstoned tasks do not count: they are not
 * coming back on their own, so counting them would talk the user out of a
 * deletion that is in fact free.
 */
export function tagUsage(tags: Tag[], tasks: Task[]): Map<string, TagUsage> {
  const usage = new Map<string, TagUsage>();
  for (const tag of tags) usage.set(tag.id, { open: 0, completed: 0, total: 0 });
  for (const task of tasks) {
    if (task.deleted) continue;
    for (const id of task.tagIds) {
      const entry = usage.get(id);
      if (!entry) continue; // a tag that no longer exists — inert, see stripping note
      if (task.completedAt === undefined) entry.open += 1;
      else entry.completed += 1;
      entry.total += 1;
    }
  }
  return usage;
}

/**
 * The key two tags must share to count as the same tag. Case and surrounding
 * or doubled whitespace are the ways a duplicate actually arises — "Work",
 * "work " and "work" are one tag that got typed three times.
 */
export function tagKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Groups of tags that are the same tag under different spellings, most-used
 * spelling first within each group so the obvious merge target leads.
 * Singletons are not returned — there is nothing to decide about them.
 */
export function duplicateGroups(tags: Tag[], usage: Map<string, TagUsage>): Tag[][] {
  const byKey = new Map<string, Tag[]>();
  for (const tag of tags) {
    const key = tagKey(tag.name);
    if (!key) continue; // a blank name is not a duplicate of another blank one
    const group = byKey.get(key) ?? [];
    group.push(tag);
    byKey.set(key, group);
  }
  return [...byKey.values()]
    .filter((group) => group.length > 1)
    .map((group) => [...group].sort((a, b) =>
      (usage.get(b.id)?.total ?? 0) - (usage.get(a.id)?.total ?? 0) || a.name.localeCompare(b.name)));
}

/** Tags in the order the management screen shows them: busiest first. */
export function sortByUsage(tags: Tag[], usage: Map<string, TagUsage>): Tag[] {
  return [...tags].sort((a, b) =>
    (usage.get(b.id)?.total ?? 0) - (usage.get(a.id)?.total ?? 0)
    || a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
}
