/**
 * A Things library the size of a real one. 25,000 rows arrive in a single
 * transaction and then land in a reactive mirror, so both the write and the
 * post-import state need to survive it — this is the one operation a user
 * cannot retry cheaply if it falls over halfway.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { AppStore } from './app.svelte';

let store: AppStore;
let n = 0;

beforeEach(async () => {
  store = new AppStore();
  await store.init(`import-scale-${n++}`);
});

function bigLibrary(open: number, done: number) {
  const lists = Array.from({ length: 40 }, (_, i) => ({
    id: `L${i}`, thingsUuid: `L${i}`, title: `List ${i}`, sortMode: 'priority' as const,
    createdAt: 100, updatedAt: 100, deleted: false,
  }));
  const tasks = [];
  for (let i = 0; i < open + done; i++) {
    const isDone = i >= open;
    tasks.push({
      id: `T${i}`, thingsUuid: `T${i}`, listId: `L${i % 40}`,
      name: `task number ${i}`, notes: i % 7 === 0 ? 'some notes here' : '',
      priority: 'medium' as const, tagIds: [], inProgress: false,
      createdAt: 100, updatedAt: 100, deleted: false,
      ...(isDone ? { completedAt: 1_700_000_000_000 + i * 1000, importedHistory: true } : {}),
    });
  }
  return {
    lists, tags: [], tasks, templates: [], review: [],
    counts: { lists: 40, tags: 0, openTasks: open, completedTasks: done, templates: 0 },
  };
}

describe('a real-sized Things import', () => {
  it('imports 25,000 rows and leaves the app usable', async () => {
    const mapped = bigLibrary(2_000, 23_000);
    const started = Date.now();
    await store.importThings(mapped);
    const importMs = Date.now() - started;
    console.log(`import of ${mapped.tasks.length} tasks took ${importMs}ms`);

    expect(store.state.tasks).toHaveLength(25_000);
    expect(store.state.lists).toHaveLength(40);

    // The counters and the open-task view are what render straight afterwards.
    const t0 = Date.now();
    const counts = store.state.tasks.filter((t) => t.completedAt === undefined).length;
    const readMs = Date.now() - t0;
    console.log(`scanning the reactive mirror took ${readMs}ms`);
    expect(counts).toBe(2_000);
    expect(importMs).toBeLessThan(60_000);
  }, 120_000);

  it('re-importing the same library adds nothing and stays fast', async () => {
    const mapped = bigLibrary(1_000, 9_000);
    await store.importThings(mapped);
    const started = Date.now();
    await store.importThings(bigLibrary(1_000, 9_000));
    console.log(`re-import of 10,000 tasks took ${Date.now() - started}ms`);
    expect(store.state.tasks).toHaveLength(10_000); // matched by thingsUuid, not duplicated
  }, 120_000);
});
