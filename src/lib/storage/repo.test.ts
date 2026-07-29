import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Task } from '../domain/types';
import { openDb, type AppDb } from './db';
import { Repo } from './repo';

let db: AppDb;
let repo: Repo;
let dbN = 0;

beforeEach(() => {
  db = openDb(`test-${dbN++}`); // fresh db per test (fake-indexeddb via src/tests/setup.ts)
  repo = new Repo(db);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Repo', () => {
  it('creates entities with ids and timestamps, and loads them back', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await repo.createList({ title: 'Home' });
    const task = await repo.createTask({
      listId: list.id, name: 'fix faucet', notes: '', priority: 'high',
      tagIds: [], inProgress: false,
    });
    expect(list.id).toBeTruthy();
    expect(task.createdAt).toBe(new Date('2026-07-15T12:00:00').getTime());
    const state = await repo.loadState();
    expect(state.lists.map((l) => l.id)).toEqual([list.id]);
    expect(state.tasks.map((t) => t.name)).toEqual(['fix faucet']);
  });

  it('updates stamp updatedAt without touching createdAt', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await repo.createList({ title: 'Home' });
    vi.setSystemTime(new Date('2026-07-15T13:00:00'));
    await repo.updateList(list.id, { title: 'House' });
    const state = await repo.loadState();
    expect(state.lists[0]!.title).toBe('House');
    expect(state.lists[0]!.createdAt).toBe(new Date('2026-07-15T12:00:00').getTime());
    expect(state.lists[0]!.updatedAt).toBe(new Date('2026-07-15T13:00:00').getTime());
  });

  it('softDelete tombstones: gone from loadState but still in the table', async () => {
    const list = await repo.createList({ title: 'Home' });
    await repo.softDelete('lists', list.id);
    expect((await repo.loadState()).lists).toHaveLength(0);
    expect((await db.lists.get(list.id))!.deleted).toBe(true);
  });

  it('clearing a template nextSpawnAt via update actually persists', async () => {
    const tpl = await repo.createTemplate({
      listId: 'L1', name: 'water plants', notes: '', tagIds: [], priority: 'medium',
      mode: { kind: 'afterCompletion', interval: 3, unit: 'days' },
      paused: false, nextSpawnAt: 12345,
    });
    await repo.updateTemplate(tpl.id, { nextSpawnAt: undefined });
    const reread = (await repo.loadState()).templates[0]!;
    expect(reread.nextSpawnAt).toBeUndefined();
  });

  it('currentTask round-trips including null, with updatedAt stamps for sync merge', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const t0 = Date.now();
    expect((await repo.loadState()).currentTask).toBeNull();
    await repo.setCurrentTask({ taskId: 'abc', acceptedAt: 123 });
    let state = await repo.loadState();
    expect(state.currentTask).toEqual({ taskId: 'abc', acceptedAt: 123 });
    expect(state.currentTaskUpdatedAt).toBe(t0);
    await repo.setCurrentTask(null);
    state = await repo.loadState();
    expect(state.currentTask).toBeNull();
    // nextStamp semantics: a change in the same millisecond still SUPERSEDES
    // what it changed — bare Date.now() here let future-stamped refs win back.
    expect(state.currentTaskUpdatedAt).toBe(t0 + 1);
  });

  it('settings default and merge, with updatedAt stamp', async () => {
    expect(await repo.getSettings()).toEqual(DEFAULT_SETTINGS);
    expect((await repo.loadState()).settingsUpdatedAt).toBe(0);
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    await repo.updateSettings({ hoursPerDay: 2 });
    expect(await repo.getSettings()).toEqual({ ...DEFAULT_SETTINGS, hoursPerDay: 2 });
    expect((await repo.loadState()).settingsUpdatedAt).toBe(Date.now());
  });

  it('reads legacy (pre-sync) kv shapes with stamp 0', async () => {
    await db.kv.put({ key: 'currentTask', value: { taskId: 'legacy', acceptedAt: 5 } });
    await db.kv.put({ key: 'settings', value: { hoursPerDay: 3 } });
    const state = await repo.loadState();
    expect(state.currentTask).toEqual({ taskId: 'legacy', acceptedAt: 5 });
    expect(state.currentTaskUpdatedAt).toBe(0);
    expect(state.settings.hoursPerDay).toBe(3);
    expect(state.settingsUpdatedAt).toBe(0);
  });

  it('data persists across a re-open of the same db name', async () => {
    const list = await repo.createList({ title: 'Persist' });
    db.close();
    const again = new Repo(openDb(db.name));
    expect((await again.loadState()).lists.map((l) => l.id)).toEqual([list.id]);
  });

  it('loadSnapshot INCLUDES tombstones (sync needs them to propagate deletes)', async () => {
    const list = await repo.createList({ title: 'Doomed' });
    await repo.softDelete('lists', list.id);
    expect((await repo.loadState()).lists).toHaveLength(0);
    const snapshot = await repo.loadSnapshot();
    expect(snapshot.lists).toHaveLength(1);
    expect(snapshot.lists[0]!.deleted).toBe(true);
  });

  it('replaceAll writes the merged snapshot in one transaction', async () => {
    const incoming = await repo.loadSnapshot();
    incoming.lists = [{
      id: 'L9', title: 'from remote', sortMode: 'priority' as const,
      createdAt: 1, updatedAt: 2, deleted: false,
    }];
    incoming.currentTask = { taskId: 'T1', acceptedAt: 3 };
    incoming.currentTaskUpdatedAt = 4;
    incoming.settings = { ...incoming.settings, hoursPerDay: 7 };
    incoming.settingsUpdatedAt = 5;
    await repo.replaceAll(incoming);
    const back = await repo.loadSnapshot();
    expect(back.lists.map((l) => l.id)).toEqual(['L9']);
    expect(back.currentTask).toEqual({ taskId: 'T1', acceptedAt: 3 });
    expect(back.currentTaskUpdatedAt).toBe(4);
    expect(back.settings.hoursPerDay).toBe(7);
    expect(back.settingsUpdatedAt).toBe(5);
  });

  describe('replaceAll vs. edits made while a sync was in flight', () => {
    // A sync cycle reads the local snapshot, spends seconds on the network, then
    // writes the merged result back. Anything the user did in between is NEWER
    // than what that snapshot holds, and must not be undone by the write.

    it('keeps a delete that landed after the snapshot was taken', async () => {
      vi.setSystemTime(new Date('2026-07-15T12:00:00'));
      const list = await repo.createList({ title: 'Doomed' });
      const inFlight = await repo.loadSnapshot(); // sync reads: list is alive

      vi.setSystemTime(new Date('2026-07-15T12:00:05')); // user deletes it
      await repo.softDelete('lists', list.id);

      await repo.replaceAll(inFlight); // sync writes back what it had read
      expect((await repo.loadState()).lists, 'the delete must survive').toHaveLength(0);
    });

    it('keeps an edit that landed after the snapshot was taken', async () => {
      vi.setSystemTime(new Date('2026-07-15T12:00:00'));
      const list = await repo.createList({ title: 'before' });
      const inFlight = await repo.loadSnapshot();

      vi.setSystemTime(new Date('2026-07-15T12:00:05'));
      await repo.updateList(list.id, { title: 'after' });

      await repo.replaceAll(inFlight);
      expect((await repo.loadState()).lists[0]!.title).toBe('after');
    });

    it('keeps a row created after the snapshot was taken', async () => {
      const inFlight = await repo.loadSnapshot();
      const fresh = await repo.createList({ title: 'typed mid-sync' });
      await repo.replaceAll(inFlight);
      expect((await repo.loadState()).lists.map((l) => l.id)).toEqual([fresh.id]);
    });

    it('still accepts remote rows that really are newer', async () => {
      vi.setSystemTime(new Date('2026-07-15T12:00:00'));
      const list = await repo.createList({ title: 'mine' });
      const incoming = await repo.loadSnapshot();
      incoming.lists = [{ ...incoming.lists[0]!, title: 'theirs', updatedAt: Date.now() + 60_000 }];
      await repo.replaceAll(incoming);
      expect((await repo.loadState()).lists[0]!.title).toBe('theirs');
      expect(list.id).toBe(incoming.lists[0]!.id);
    });

    it('keeps settings and the current task changed mid-sync', async () => {
      vi.setSystemTime(new Date('2026-07-15T12:00:00'));
      const incoming = await repo.loadSnapshot();
      incoming.settings = { ...incoming.settings, hoursPerDay: 3 };
      incoming.settingsUpdatedAt = Date.now();
      incoming.currentTask = { taskId: 'stale', acceptedAt: 1 };
      incoming.currentTaskUpdatedAt = Date.now();

      vi.setSystemTime(new Date('2026-07-15T12:00:05'));
      await repo.updateSettings({ hoursPerDay: 9 });
      await repo.setCurrentTask({ taskId: 'fresh', acceptedAt: 2 });

      await repo.replaceAll(incoming);
      const back = await repo.loadState();
      expect(back.settings.hoursPerDay).toBe(9);
      expect(back.currentTask).toEqual({ taskId: 'fresh', acceptedAt: 2 });
    });

    it('keeps a discovery earned mid-sync', async () => {
      await repo.setKv('eggState', { unlocks: ['earned-just-now'], storyStage: 3 });
      const incoming = await repo.loadSnapshot();
      incoming.delight = {
        unlocks: ['from-the-other-device'], storyStage: 1,
        triviaCorrect: 0, triviaTotal: 0, streakDays: 0, lastCompletionDay: '',
      };
      await repo.replaceAll(incoming);
      const eggs = await repo.getKv<{ unlocks: string[]; storyStage: number }>('eggState');
      expect(eggs!.unlocks).toEqual(['earned-just-now', 'from-the-other-device']);
      expect(eggs!.storyStage, 'never rewound').toBe(3);
    });
  });

  it('sync auth kv round-trips and clears', async () => {
    expect(await repo.getSyncAuth()).toBeNull();
    await repo.setSyncAuth({ owner: 'me', repo: 'data', token: 'tok' });
    expect(await repo.getSyncAuth()).toEqual({ owner: 'me', repo: 'data', token: 'tok' });
    await repo.clearSyncAuth();
    expect(await repo.getSyncAuth()).toBeNull();
  });
});

describe('a change must always beat what it changed', () => {
  // Rows can carry a future updatedAt for mundane reasons — a wrong clock, an
  // import that misread its source epoch. Since updatedAt is the sync merge
  // key, stamping an edit with a lower number makes the edit lose to the copy
  // it was replacing: it reverts on the next sync, and a delete comes back.

  it('a delete outranks a row stamped in the future', async () => {
    const list = await repo.createList({ title: 'imported' });
    const future = Date.now() + 30 * 365 * 86_400_000;
    await repo.replaceAll({ ...(await repo.loadSnapshot()), lists: [{ ...list, updatedAt: future }] });

    await repo.softDelete('lists', list.id);
    const tombstone = (await repo.loadSnapshot()).lists[0]!;
    expect(tombstone.deleted).toBe(true);
    expect(tombstone.updatedAt, 'must outrank the row it buries').toBeGreaterThan(future);
  });

  it('an edit outranks a row stamped in the future', async () => {
    const list = await repo.createList({ title: 'before' });
    const future = Date.now() + 30 * 365 * 86_400_000;
    await repo.replaceAll({ ...(await repo.loadSnapshot()), lists: [{ ...list, updatedAt: future }] });

    await repo.updateList(list.id, { title: 'after' });
    expect((await repo.loadSnapshot()).lists[0]!.updatedAt).toBeGreaterThan(future);
  });

  it('successive edits keep climbing rather than sticking', async () => {
    const list = await repo.createList({ title: 'x' });
    const future = Date.now() + 30 * 365 * 86_400_000;
    await repo.replaceAll({ ...(await repo.loadSnapshot()), lists: [{ ...list, updatedAt: future }] });

    await repo.updateList(list.id, { title: 'a' });
    const first = (await repo.loadSnapshot()).lists[0]!.updatedAt;
    await repo.updateList(list.id, { title: 'b' });
    expect((await repo.loadSnapshot()).lists[0]!.updatedAt).toBeGreaterThan(first);
  });

  it('ordinary edits still stamp the wall clock, not a running counter', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await repo.createList({ title: 'x' });
    vi.setSystemTime(new Date('2026-07-15T12:00:05'));
    await repo.updateList(list.id, { title: 'y' });
    expect((await repo.loadSnapshot()).lists[0]!.updatedAt)
      .toBe(new Date('2026-07-15T12:00:05').getTime());
  });
});

describe('eager task creation', () => {
  it('returns the row synchronously and persists it', async () => {
    const row = repo.createTaskEager({
      listId: 'L1', name: '', notes: '', priority: 'medium',
      tagIds: [], inProgress: false, needsReview: true,
    });
    expect(row.id).toBeTruthy(); // usable before any await
    await repo.taskPersisted(row.id);
    expect((await repo.loadSnapshot()).tasks.map((t) => t.id)).toEqual([row.id]);
  });

  it('a patch fired straight after creation cannot outrun the insert', async () => {
    // The hazard: patchRow reads first, and a read racing an in-flight insert
    // finds nothing and silently drops the patch — a typed name lost on
    // reload. Slow the insert to force the race the wrong way round.
    const realPut = db.tasks.put.bind(db.tasks);
    let slowedOnce = false;
    vi.spyOn(db.tasks, 'put').mockImplementation(((row: Task) => {
      if (!slowedOnce) {
        slowedOnce = true;
        return new Promise((resolve) => setTimeout(resolve, 40)).then(() => realPut(row));
      }
      return realPut(row);
    }) as typeof db.tasks.put);

    const row = repo.createTaskEager({
      listId: 'L1', name: '', notes: '', priority: 'medium',
      tagIds: [], inProgress: false, needsReview: true,
    });
    await repo.updateTask(row.id, { name: 'typed immediately' });
    expect((await repo.loadSnapshot()).tasks[0]!.name).toBe('typed immediately');
  });

  it('a discard fired straight after creation still lands', async () => {
    const realPut = db.tasks.put.bind(db.tasks);
    let slowedOnce = false;
    vi.spyOn(db.tasks, 'put').mockImplementation(((row: Task) => {
      if (!slowedOnce) {
        slowedOnce = true;
        return new Promise((resolve) => setTimeout(resolve, 40)).then(() => realPut(row));
      }
      return realPut(row);
    }) as typeof db.tasks.put);
    const row = repo.createTaskEager({
      listId: 'L1', name: '', notes: '', priority: 'medium',
      tagIds: [], inProgress: false, needsReview: true,
    });
    await repo.softDelete('tasks', row.id);
    expect((await repo.loadSnapshot()).tasks[0]!.deleted).toBe(true);
  });
});
