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

  it('records working time when a task is finished while in progress', async () => {
    vi.setSystemTime(new Date('2026-07-27T09:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.acceptTask(a.id);
    expect(store.state.tasks[0]!.startedAt).toBe(new Date('2026-07-27T09:00:00').getTime());

    vi.setSystemTime(new Date('2026-07-27T09:25:00'));
    await store.completeTask(a.id);
    expect(store.state.tasks[0]!.activeMs).toBe(25 * 60_000);
  });

  it('ticking a task off without ever working on it records no time', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.completeTask(a.id);
    expect(store.state.tasks[0]!.activeMs).toBeUndefined();
  });

  it('pausing banks the stretch, and resuming continues from there', async () => {
    vi.setSystemTime(new Date('2026-07-27T09:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);

    await store.setInProgress(a.id, true);
    vi.setSystemTime(new Date('2026-07-27T09:10:00'));
    await store.setInProgress(a.id, false); // 10 minutes banked
    expect(store.state.tasks[0]!.activeAccumulatedMs).toBe(10 * 60_000);
    expect(store.state.tasks[0]!.startedAt).toBeUndefined();

    vi.setSystemTime(new Date('2026-07-27T11:00:00')); // two hours away, not counted
    await store.setInProgress(a.id, true);
    vi.setSystemTime(new Date('2026-07-27T11:05:00'));
    await store.completeTask(a.id);
    expect(store.state.tasks[0]!.activeMs).toBe(15 * 60_000); // 10 + 5, not the gap
  });

  it('completing after pausing discards the time — it was never tracked to the end', async () => {
    vi.setSystemTime(new Date('2026-07-27T09:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.setInProgress(a.id, true);
    vi.setSystemTime(new Date('2026-07-27T09:30:00'));
    await store.setInProgress(a.id, false);
    await store.completeTask(a.id); // ticked off the list later
    expect(store.state.tasks[0]!.activeMs).toBeUndefined();
  });

  it('a task timebox starts its countdown on accept and clears on completion', async () => {
    vi.setSystemTime(new Date('2026-07-27T09:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.patchTask(a.id, { timeboxMinutes: 15 });
    await store.acceptTask(a.id);
    expect(store.state.tasks[0]!.timeboxEndsAt).toBe(new Date('2026-07-27T09:15:00').getTime());

    await store.completeTask(a.id);
    expect(store.state.tasks[0]!.timeboxEndsAt).toBeUndefined();
  });

  it('recurring templates learn how long their instances really take', async () => {
    vi.setSystemTime(new Date('2026-07-27T09:00:00'));
    const list = await store.addList('L');
    const first = await store.addTask(list.id);
    const tpl = await store.createRecurring(first.id, { kind: 'afterCompletion', interval: 1, unit: 'days' });

    await store.acceptTask(first.id);
    vi.setSystemTime(new Date('2026-07-27T09:20:00')); // 20 minutes
    await store.completeTask(first.id);
    let saved = store.state.templates.find((t) => t.id === tpl.id)!;
    expect(saved.completedInstances).toBe(1);
    expect(saved.avgActiveMs).toBe(20 * 60_000);

    // a second, slower instance pulls the average up to 30 minutes
    const second = await store.addTask(list.id);
    await store.patchTask(second.id, { recurrenceId: tpl.id });
    await store.acceptTask(second.id);
    vi.setSystemTime(new Date('2026-07-27T10:00:00')); // 40 minutes
    await store.completeTask(second.id);
    saved = store.state.templates.find((t) => t.id === tpl.id)!;
    expect(saved.completedInstances).toBe(2);
    expect(saved.avgActiveMs).toBe(30 * 60_000);
  });

  it('bulk actions apply to every selected task and undo as one step', async () => {
    const from = await store.addList('From');
    const to = await store.addList('To');
    const a = await store.addTask(from.id);
    const b = await store.addTask(from.id);
    await store.patchTask(a.id, { name: 'one' });
    await store.patchTask(b.id, { name: 'two' });

    await store.bulkApply([a.id, b.id], 'move', to.id);
    expect(store.state.tasks.every((t) => t.listId === to.id)).toBe(true);
    expect(await store.undoLast()).toBe('Moved 2 tasks');
    expect(store.state.tasks.every((t) => t.listId === from.id)).toBe(true);

    await store.bulkApply([a.id, b.id], 'priority', 'max');
    expect(store.state.tasks.every((t) => t.priority === 'max')).toBe(true);
    await store.undoLast();
    expect(store.state.tasks.every((t) => t.priority === 'medium')).toBe(true);

    await store.bulkApply([a.id, b.id], 'complete');
    expect(store.state.tasks.every((t) => t.completedAt !== undefined)).toBe(true);
    // One undo, not one per task
    expect(await store.undoLast()).toBe('Completed 2 tasks');
    expect(store.state.tasks.every((t) => t.completedAt === undefined)).toBe(true);

    await store.bulkApply([a.id, b.id], 'delete');
    expect(store.state.tasks).toHaveLength(0);
    await store.undoLast();
    expect(store.state.tasks).toHaveLength(2);
  });

  it('undo restores a completed task, its in-progress flag, and its current-task slot', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.patchTask(a.id, { name: 'oops' });
    await store.acceptTask(a.id);
    await store.completeTask(a.id);
    expect(store.state.tasks[0]!.completedAt).toBeGreaterThan(0);
    expect(store.state.currentTask).toBeNull();

    expect(await store.undoLast()).toBe('Completed "oops"');
    const back = store.state.tasks[0]!;
    expect(back.completedAt).toBeUndefined();
    expect(back.inProgress).toBe(true);
    expect(store.state.currentTask?.taskId).toBe(a.id);
    expect((await persisted()).tasks[0]!.completedAt).toBeUndefined();
  });

  it('undo un-arms a recurrence that the completion scheduled', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    const tpl = await store.createRecurring(a.id, { kind: 'afterCompletion', interval: 3, unit: 'days' });
    await store.completeTask(a.id);
    expect(store.state.templates[0]!.nextSpawnAt).toBeGreaterThan(0);

    await store.undoLast();
    expect(store.state.templates.find((t) => t.id === tpl.id)!.nextSpawnAt).toBeUndefined();
  });

  it('undo restores a deleted task and a deleted list with its tasks', async () => {
    const list = await store.addList('Doomed');
    const t = await store.addTask(list.id);
    await store.patchTask(t.id, { name: 'keepme' });

    await store.removeTask(t.id);
    expect(store.state.tasks).toHaveLength(0);
    await store.undoLast();
    expect(store.state.tasks.map((x) => x.name)).toEqual(['keepme']);

    await store.removeList(list.id);
    expect(store.state.lists).toHaveLength(0);
    expect(await store.undoLast()).toBe('Deleted list "Doomed"');
    expect(store.state.lists).toHaveLength(1);
    expect(store.state.tasks.map((x) => x.name)).toEqual(['keepme']);
  });

  it('undo lifts a snooze and puts the task back as current', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.acceptTask(a.id);
    await store.sendNotToday(a.id);
    expect(store.state.tasks[0]!.notTodayUntil).toBeGreaterThan(0);
    expect(store.state.currentTask).toBeNull();

    await store.undoLast();
    expect(store.state.tasks[0]!.notTodayUntil).toBeUndefined();
    expect(store.state.currentTask?.taskId).toBe(a.id);
  });

  it('the pristine sweep is silent — it never lands on the undo stack', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.patchTask(a.id, { name: 'real one' });
    await store.removeTask(a.id);         // undoable
    const b = await store.addTask(list.id);
    await store.discardIfPristine(b.id);  // silent
    // Still the deletion of "real one" on top, not the discarded blank.
    expect(await store.undoLast()).toBe('Deleted "real one"');
  });

  it('new tasks start untriaged; markReviewed clears it and is idempotent', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    expect(a.needsReview).toBe(true);
    expect(store.tasksNeedingReview().map((t) => t.id)).toEqual([a.id]);

    await store.markReviewed(a.id);
    expect(store.state.tasks[0]!.needsReview).toBe(false);
    expect((await persisted()).tasks[0]!.needsReview).toBe(false);

    // A second call must not bump updatedAt — that would cost sync merges.
    const stamp = store.state.tasks[0]!.updatedAt;
    await store.markReviewed(a.id);
    expect(store.state.tasks[0]!.updatedAt).toBe(stamp);
  });

  it('completed tasks never sit in the triage pool', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.completeTask(a.id);
    expect(store.tasksNeedingReview()).toHaveLength(0);
  });

  it('a task whose field was touched survives the pristine sweep', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.markReviewed(a.id); // stands in for "tapped a priority chip"
    expect(await store.discardIfPristine(a.id)).toBe(false);
    expect(store.state.tasks).toHaveLength(1);
  });

  it('autoSelectNext ON: completing the current task draws and accepts the next', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    const b = await store.addTask(list.id);
    await store.updateSettings({ autoSelectNext: true });
    await store.acceptTask(a.id);
    await store.completeTask(a.id);
    expect(store.state.currentTask?.taskId).toBe(b.id);
    expect(store.state.tasks.find((t) => t.id === b.id)!.inProgress).toBe(true);
  });

  it('autoSelectNext OFF: completing the current task just clears it', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.addTask(list.id);
    await store.acceptTask(a.id);
    await store.completeTask(a.id);
    expect(store.state.currentTask).toBeNull();
  });

  it('setInProgress toggles and persists', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.setInProgress(a.id, true);
    expect((await persisted()).tasks[0]!.inProgress).toBe(true);
    await store.setInProgress(a.id, false);
    expect((await persisted()).tasks[0]!.inProgress).toBe(false);
  });

  it('createRecurring weekly arms nextSpawnAt, links the task, snapshots fields', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00')); // Wednesday
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.patchTask(a.id, { name: 'weekly thing', priority: 'high' });
    const tpl = await store.createRecurring(a.id, { kind: 'weekly', weekdays: [1] });
    expect(tpl.name).toBe('weekly thing');
    expect(tpl.priority).toBe('high');
    expect(tpl.nextSpawnAt).toBe(new Date('2026-07-20T04:00:00').getTime());
    expect(store.state.tasks.find((t) => t.id === a.id)!.recurrenceId).toBe(tpl.id);
    expect((await persisted()).templates[0]!.nextSpawnAt).toBe(tpl.nextSpawnAt);
  });

  it('afterCompletion template arms only when its task completes', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    const tpl = await store.createRecurring(a.id, { kind: 'afterCompletion', interval: 3, unit: 'days' });
    expect(tpl.nextSpawnAt).toBeUndefined();
    await store.completeTask(a.id);
    const armed = store.state.templates.find((t) => t.id === tpl.id)!;
    expect(armed.nextSpawnAt).toBe(new Date('2026-07-18T12:00:00').getTime());
    expect((await persisted()).templates[0]!.nextSpawnAt).toBe(armed.nextSpawnAt);
  });

  it('completing a task with a dangling recurrenceId does not throw', async () => {
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.patchTask(a.id, { recurrenceId: 'ghost' });
    await expect(store.completeTask(a.id)).resolves.toBeUndefined();
  });

  it('runSpawnSweep spawns a due weekly instance once, then respects skip-if-open', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.patchTask(a.id, { name: 'weekly thing' });
    const tpl = await store.createRecurring(a.id, { kind: 'weekly', weekdays: [1] });
    await store.completeTask(a.id); // original instance out of the way

    vi.setSystemTime(new Date('2026-07-20T05:00:00')); // Monday past 4am
    const spawned = await store.runSpawnSweep();
    expect(spawned).toBe(1);
    const open = store.state.tasks.filter((t) => t.completedAt === undefined);
    expect(open).toHaveLength(1);
    expect(open[0]!.name).toBe('weekly thing');
    expect(open[0]!.recurrenceId).toBe(tpl.id);
    expect(open[0]!.listId).toBe(list.id);

    const again = await store.runSpawnSweep(); // same day, instance still open
    expect(again).toBe(0);
    expect(store.state.templates[0]!.nextSpawnAt).toBe(new Date('2026-07-27T04:00:00').getTime());
    expect((await persisted()).tasks.filter((t) => t.completedAt === undefined)).toHaveLength(1);
  });

  it('due afterCompletion template spawns then disarms', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.createRecurring(a.id, { kind: 'afterCompletion', interval: 3, unit: 'days' });
    await store.completeTask(a.id);

    vi.setSystemTime(new Date('2026-07-19T12:00:00'));
    expect(await store.runSpawnSweep()).toBe(1);
    expect(store.state.templates[0]!.nextSpawnAt).toBeUndefined();
    expect((await persisted()).templates[0]!.nextSpawnAt).toBeUndefined();
  });

  it('importThings: fresh import remaps ids, resolves refs, and re-import is idempotent', async () => {
    const mapped = {
      lists: [{ id: 'TP1', thingsUuid: 'TP1', title: 'Garden', sortMode: 'priority' as const, createdAt: 100, updatedAt: 100, deleted: false }],
      tags: [{ id: 'TG1', thingsUuid: 'TG1', name: 'green', colorIndex: 0, createdAt: 100, updatedAt: 100, deleted: false }],
      tasks: [{
        id: 'TT1', thingsUuid: 'TT1', listId: 'TP1', name: 'plant', notes: '', priority: 'medium' as const,
        tagIds: ['TG1'], inProgress: false, createdAt: 100, updatedAt: 100, deleted: false,
      }],
      templates: [{
        id: 'TR1', thingsUuid: 'TR1', listId: 'TP1', name: 'water', notes: '', tagIds: [],
        priority: 'medium' as const, mode: { kind: 'weekly' as const, weekdays: [1] },
        paused: false, createdAt: 100, updatedAt: 100, deleted: false,
      }],
      review: [], counts: { lists: 1, tags: 1, openTasks: 1, completedTasks: 0, templates: 1 },
    };
    await store.importThings(mapped);
    const list = store.state.lists.find((l) => l.thingsUuid === 'TP1')!;
    expect(list.id).not.toBe('TP1'); // remapped to an app id
    const task = store.state.tasks.find((t) => t.thingsUuid === 'TT1')!;
    expect(task.listId).toBe(list.id); // ref resolved
    expect(task.tagIds).toEqual([store.state.tags[0]!.id]);
    expect(store.state.templates[0]!.listId).toBe(list.id);

    await store.importThings(mapped); // identical re-import
    expect(store.state.lists).toHaveLength(1);
    expect(store.state.tasks).toHaveLength(1);
    expect((await persisted()).tasks).toHaveLength(1);
  });

  it('importThings: re-import never clobbers a newer local edit', async () => {
    const mapped = {
      lists: [{ id: 'TP1', thingsUuid: 'TP1', title: 'Garden', sortMode: 'priority' as const, createdAt: 100, updatedAt: 100, deleted: false }],
      tags: [], templates: [], review: [],
      tasks: [{
        id: 'TT1', thingsUuid: 'TT1', listId: 'TP1', name: 'original', notes: '', priority: 'medium' as const,
        tagIds: [], inProgress: false, createdAt: 100, updatedAt: 100, deleted: false,
      }],
      counts: { lists: 1, tags: 0, openTasks: 1, completedTasks: 0, templates: 0 },
    };
    await store.importThings(mapped);
    const appId = store.state.tasks[0]!.id;
    await store.patchTask(appId, { name: 'locally renamed' }); // updatedAt = now ≫ 100
    await store.importThings(mapped);
    expect(store.state.tasks[0]!.name).toBe('locally renamed');
  });

  it('paused templates never spawn; removeRecurring tombstones', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    const tpl = await store.createRecurring(a.id, { kind: 'weekly', weekdays: [1] });
    await store.completeTask(a.id);
    await store.updateRecurring(tpl.id, { paused: true });

    vi.setSystemTime(new Date('2026-07-20T05:00:00'));
    expect(await store.runSpawnSweep()).toBe(0);

    await store.removeRecurring(tpl.id);
    expect(store.state.templates).toHaveLength(0);
    const db = openDb(dbName);
    expect((await db.templates.get(tpl.id))!.deleted).toBe(true);
  });
});
