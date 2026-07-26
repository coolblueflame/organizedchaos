/**
 * Manual validation harness — inert in CI. Point THINGS_DB at a local Things
 * `main.sqlite` COPY to run the real import pipeline and print a summary:
 *
 *   THINGS_DB=/path/to/main.sqlite npx vitest run src/lib/import/inspect.manual.test.ts
 *
 * Prints counts + every decoded recurrence for eyeball verification. Never
 * commit any of its output — real task data stays off the repo.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import initSqlJs from 'sql.js';
import { readThingsRows } from './thingsRead';
import { mapThings } from './thingsMap';

describe('manual Things-db inspection', () => {
  it.skipIf(!process.env.THINGS_DB)('maps a real database without exploding', async () => {
    const SQL = await initSqlJs();
    const bytes = new Uint8Array(readFileSync(process.env.THINGS_DB!));
    const rows = readThingsRows(SQL, bytes);
    const m = mapThings(rows);

    console.log('[inspect] raw rows:', {
      tasks: rows.tasks.length, areas: rows.areas.length, tags: rows.tags.length,
      taskTags: rows.taskTags.length, checklist: rows.checklistItems.length,
    });
    console.log('[inspect] mapped counts:', m.counts);
    console.log('[inspect] lists:', m.lists.length, 'sample:',
      m.lists.slice(0, 5).map((l) => `${l.title}${l.areaGroup ? ` @${l.areaGroup}` : ''}`));
    for (const r of m.review) console.log('[inspect] recurrence:', r.message);

    expect(m.counts.openTasks + m.counts.completedTasks).toBeGreaterThan(0);
    // Every task's list reference must resolve to an emitted list.
    const listIds = new Set(m.lists.map((l) => l.id));
    const dangling = m.tasks.filter((t) => !listIds.has(t.listId));
    expect(dangling.map((t) => t.name)).toEqual([]);
  });
});
