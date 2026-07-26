import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../domain/types';
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
    expect(state.currentTaskUpdatedAt).toBe(t0);
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
});
