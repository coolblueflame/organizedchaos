/**
 * Dexie database schema. Index strings list ONLY the queryable keys — full
 * objects are stored regardless. Schema changes require a new version() block
 * with a migration; bump thoughtfully once real data exists.
 */
import Dexie, { type Table } from 'dexie';
import type { List, RecurrenceTemplate, Tag, Task } from '../domain/types';

export class AppDb extends Dexie {
  lists!: Table<List, string>;
  tasks!: Table<Task, string>;
  tags!: Table<Tag, string>;
  templates!: Table<RecurrenceTemplate, string>;
  /** Singletons: 'currentTask', 'settings' — small, no schema churn. */
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      lists: 'id, updatedAt',
      tasks: 'id, listId, updatedAt, completedAt, recurrenceId',
      tags: 'id, updatedAt',
      templates: 'id, updatedAt, nextSpawnAt',
      kv: 'key',
    });
  }
}

export function openDb(name = 'organizedchaos'): AppDb {
  return new AppDb(name);
}
