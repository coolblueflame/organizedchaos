import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../storage/db';
import { Repo } from '../storage/repo';
import { AppStore } from './app.svelte';

let store: AppStore;
let dbName: string;
let dbN = 0;

beforeEach(async () => {
  dbName = `store-test-${dbN++}`;
  store = new AppStore();
  await store.init(dbName);
});

afterEach(() => {
  vi.useRealTimers();
});

/** The mirror must always agree with what a cold reload would see. */
async function persisted() {
  return new Repo(openDb(dbName)).loadState();
}

describe('AppStore', () => {
  it('starts ready with empty state on a fresh db', () => {
    expect(store.ready).toBe(true);
    expect(store.state.lists).toEqual([]);
    expect(store.state.tasks).toEqual([]);
  });

  it('addList / renameList / setListSort update mirror and disk', async () => {
    const list = await store.addList('Chores');
    await store.renameList(list.id, 'House Chores');
    await store.setListSort(list.id, 'date');
    expect(store.state.lists[0]!.title).toBe('House Chores');
    expect(store.state.lists[0]!.sortMode).toBe('date');
    const disk = await persisted();
    expect(disk.lists[0]!.title).toBe('House Chores');
    expect(disk.lists[0]!.sortMode).toBe('date');
  });

  it('addTask creates a blank medium task in the list', async () => {
    const list = await store.addList('Chores');
    const task = await store.addTask(list.id);
    expect(task.priority).toBe('medium');
    expect(task.name).toBe('');
    expect(store.state.tasks.map((t) => t.id)).toEqual([task.id]);
    expect((await persisted()).tasks.map((t) => t.id)).toEqual([task.id]);
  });

  it('completeTask stamps completedAt and clears inProgress; uncompleteTask reverses', async () => {
    const list = await store.addList('Chores');
    const task = await store.addTask(list.id);
    await store.patchTask(task.id, { inProgress: true });
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    await store.completeTask(task.id);
    const done = store.state.tasks.find((t) => t.id === task.id)!;
    expect(done.completedAt).toBe(new Date('2026-07-15T12:00:00').getTime());
    expect(done.inProgress).toBe(false);
    expect((await persisted()).tasks[0]!.completedAt).toBe(done.completedAt);

    await store.uncompleteTask(task.id);
    expect(store.state.tasks.find((t) => t.id === task.id)!.completedAt).toBeUndefined();
    expect((await persisted()).tasks[0]!.completedAt).toBeUndefined();
  });

  it('removeTask / restoreTask round-trips through the tombstone', async () => {
    const list = await store.addList('Chores');
    const task = await store.addTask(list.id);
    await store.removeTask(task.id);
    expect(store.state.tasks).toHaveLength(0);
    expect((await persisted()).tasks).toHaveLength(0);
    await store.restoreTask(task.id);
    expect(store.state.tasks.map((t) => t.id)).toEqual([task.id]);
    expect((await persisted()).tasks.map((t) => t.id)).toEqual([task.id]);
  });

  it('removeList tombstones its open tasks (returning their ids) and restoreList revives them', async () => {
    const list = await store.addList('Doomed');
    const open = await store.addTask(list.id);
    const done = await store.addTask(list.id);
    await store.completeTask(done.id);
    const removedTaskIds = await store.removeList(list.id);
    expect(removedTaskIds).toEqual([open.id]); // completed tasks stay (spec §6: history survives)
    expect(store.state.lists).toHaveLength(0);
    expect(store.state.tasks.map((t) => t.id)).toEqual([done.id]);

    await store.restoreList(list.id, removedTaskIds);
    expect(store.state.lists.map((l) => l.id)).toEqual([list.id]);
    expect(store.state.tasks.map((t) => t.id).sort()).toEqual([open.id, done.id].sort());
    expect((await persisted()).lists).toHaveLength(1);
  });

  it('addTag updates mirror and disk', async () => {
    const tag = await store.addTag('urgent', 4);
    expect(store.state.tags.map((t) => t.name)).toEqual(['urgent']);
    expect((await persisted()).tags.map((t) => t.id)).toEqual([tag.id]);
  });

  it('init loads pre-existing data', async () => {
    await store.addList('Persisted');
    const fresh = new AppStore();
    await fresh.init(dbName);
    expect(fresh.state.lists.map((l) => l.title)).toEqual(['Persisted']);
  });

  it('acceptTask sets current + inProgress; accepting another swaps current but keeps old inProgress', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    const b = await store.addTask(list.id);
    await store.acceptTask(a.id);
    expect(store.state.currentTask?.taskId).toBe(a.id);
    expect(store.state.tasks.find((t) => t.id === a.id)!.inProgress).toBe(true);
    await store.acceptTask(b.id);
    expect(store.state.currentTask?.taskId).toBe(b.id);
    expect(store.state.tasks.find((t) => t.id === a.id)!.inProgress).toBe(true);
    expect((await persisted()).currentTask?.taskId).toBe(b.id);
  });

  it('sendNotToday snoozes until next 4am and clears current if it was current', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.acceptTask(a.id);
    await store.sendNotToday(a.id);
    const snoozed = store.state.tasks.find((t) => t.id === a.id)!;
    expect(snoozed.notTodayUntil).toBe(new Date('2026-07-16T04:00:00').getTime());
    expect(snoozed.inProgress).toBe(true); // stays in progress — only the pool is affected
    expect(store.state.currentTask).toBeNull();
    expect((await persisted()).tasks[0]!.notTodayUntil).toBe(snoozed.notTodayUntil);
  });

  it('clearCurrent leaves the task untouched', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.acceptTask(a.id);
    await store.clearCurrent();
    expect(store.state.currentTask).toBeNull();
    expect(store.state.tasks.find((t) => t.id === a.id)!.inProgress).toBe(true);
  });

  it('setInProgress toggles and persists', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.setInProgress(a.id, true);
    expect((await persisted()).tasks[0]!.inProgress).toBe(true);
    await store.setInProgress(a.id, false);
    expect((await persisted()).tasks[0]!.inProgress).toBe(false);
  });
});
