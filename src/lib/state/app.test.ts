import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openDb } from '../storage/db';
import { Repo } from '../storage/repo';
import { AppStore } from './app.svelte';
import { undoStack } from './undo.svelte';
import { eligibleForDraw } from '../domain/randomizer';

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

describe('the day queue', () => {
  it('add / remove / reorder round-trip mirror and disk', async () => {
    const list = await store.addList('Plan');
    const a = await store.addTask(list.id);
    const b = await store.addTask(list.id);
    await store.addToQueue(a.id);
    await store.addToQueue(b.id);
    expect(store.state.queueIds).toEqual([a.id, b.id]);
    await store.reorderQueue([b.id, a.id]);
    expect(store.state.queueIds).toEqual([b.id, a.id]);
    const disk = await persisted();
    expect(disk.queueIds).toEqual([b.id, a.id]);
    expect(disk.queueUpdatedAt).toBeGreaterThan(0);
    await store.removeFromQueue(b.id);
    expect(store.state.queueIds).toEqual([a.id]);
  });

  it('completing a queued task drains it from the live queue', async () => {
    const list = await store.addList('Plan');
    const a = await store.addTask(list.id);
    await store.addToQueue(a.id);
    await store.completeTask(a.id);
    expect(store.queuedTasks()).toEqual([]);
  });

  it('the undo entry is armed before the write settles (Cmd+Z mid-flight)', async () => {
    const list = await store.addList('Plan');
    const a = await store.addTask(list.id);
    await store.addToQueue(a.id);
    // Widen the window: the disk write dawdles while the mirror already shows
    // an empty queue — an immediate undo must still find the clear on the stack.
    const repo = (store as unknown as { repo: Repo }).repo;
    const slow = vi.spyOn(repo, 'updateQueue').mockImplementation(async (ids: string[]) => {
      await new Promise((r) => setTimeout(r, 40));
      slow.mockRestore();
      return repo.updateQueue(ids);
    });
    const clearing = store.clearQueue();
    const undone = await store.undoLast(); // fired before `clearing` resolves
    await clearing;
    expect(undone).toBe('Cleared the queue');
    expect(store.state.queueIds).toEqual([a.id]);
  });

  it('clearQueue is undoable', async () => {
    const list = await store.addList('Plan');
    const a = await store.addTask(list.id);
    await store.addToQueue(a.id);
    await store.clearQueue();
    expect(store.state.queueIds).toEqual([]);
    await store.undoLast();
    expect(store.state.queueIds).toEqual([a.id]);
    const disk = await persisted();
    expect(disk.queueIds).toEqual([a.id]);
  });
});

describe('per-window rituals', () => {
  const WINDOWS = [
    { days: [0, 1, 2, 3, 4, 5, 6], from: '09:00', to: '09:30' },
    { days: [0, 1, 2, 3, 4, 5, 6], from: '14:00', to: '14:30' },
  ];

  it('each completion credits one window; the last one completes the day', async () => {
    vi.setSystemTime(new Date('2026-07-29T09:10:00'));
    const list = await store.addList('Health');
    const t = await store.addTask(list.id);
    await store.patchTask(t.id, { name: 'drink water', rituals: WINDOWS, ritualPerWindow: true });

    await store.completeTask(t.id);
    let row = store.state.tasks.find((x) => x.id === t.id)!;
    expect(row.ritualDoneSlots).toEqual(['2026-07-29#0']);
    expect(row.ritualDoneDay).toBeUndefined(); // the afternoon is still owed
    expect(row.completedAt).toBeUndefined(); // the ritual itself never completes

    vi.setSystemTime(new Date('2026-07-29T14:10:00'));
    await store.completeTask(t.id);
    row = store.state.tasks.find((x) => x.id === t.id)!;
    expect(row.ritualDoneSlots).toEqual(['2026-07-29#0', '2026-07-29#1']);
    expect(row.ritualDoneDay).toBe('2026-07-29'); // day closed with the last window

    // Two history records — each window's completion counts on its own.
    const records = store.state.tasks.filter(
      (x) => x.name === 'drink water' && x.completedAt !== undefined,
    );
    expect(records).toHaveLength(2);

    // Nothing owed any more — but a third completion is still real work that
    // really happened: it writes its record and leaves the day's marks alone.
    // (It used to be a silent no-op, which stranded an already-done ritual
    // re-accepted as the current task — Ben's 2026-08-05 report.)
    await store.completeTask(t.id);
    row = store.state.tasks.find((x) => x.id === t.id)!;
    expect(row.ritualDoneSlots).toEqual(['2026-07-29#0', '2026-07-29#1']);
    expect(row.ritualDoneDay).toBe('2026-07-29');
    expect(store.state.tasks.filter(
      (x) => x.name === 'drink water' && x.completedAt !== undefined,
    )).toHaveLength(3);
  });

  it("undo restores ritualDoneDay to what it WAS, not to today's mutated value", async () => {
    vi.setSystemTime(new Date('2026-07-29T12:00:00'));
    const list = await store.addList('Life');
    const t = await store.addTask(list.id);
    await store.patchTask(t.id, {
      name: 'feed cats',
      ritual: { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' },
    });

    await store.completeTask(t.id);
    expect(store.state.tasks.find((x) => x.id === t.id)!.ritualDoneDay).toBe('2026-07-29');

    // The undo closure must have captured the PRE-completion value — patchTask
    // mutates the mirror row in place, so a late read sees today and the
    // "restored" ritual stays done, silently no-oping every later completion.
    await store.undoLast();
    expect(store.state.tasks.find((x) => x.id === t.id)!.ritualDoneDay).toBeUndefined();

    // Completing again genuinely takes.
    await store.completeTask(t.id);
    expect(store.state.tasks.find((x) => x.id === t.id)!.ritualDoneDay).toBe('2026-07-29');
    expect(store.state.tasks.filter(
      (x) => x.name === 'feed cats' && x.completedAt !== undefined,
    )).toHaveLength(1);
  });

  it('undo lifts the slot and the history record together', async () => {
    vi.setSystemTime(new Date('2026-07-29T09:10:00'));
    const list = await store.addList('Health');
    const t = await store.addTask(list.id);
    await store.patchTask(t.id, { name: 'stretch', rituals: WINDOWS, ritualPerWindow: true });
    await store.completeTask(t.id);
    await store.undoLast();
    const row = store.state.tasks.find((x) => x.id === t.id)!;
    expect(row.ritualDoneSlots ?? undefined).toBeUndefined();
    expect(store.state.tasks.filter(
      (x) => x.name === 'stretch' && x.completedAt !== undefined,
    )).toHaveLength(0);
  });
});

describe('completion undo restores everything it destroyed', () => {
  it('a running timebox comes back on undo', async () => {
    const list = await store.addList('A');
    const t = await store.addTask(list.id);
    await store.startTimebox(t.id, 25);
    const endsAt = store.state.tasks.find((x) => x.id === t.id)!.timeboxEndsAt!;
    await store.completeTask(t.id);
    expect(store.state.tasks.find((x) => x.id === t.id)!.timeboxEndsAt).toBeUndefined();
    await store.undoLast();
    expect(store.state.tasks.find((x) => x.id === t.id)!.timeboxEndsAt).toBe(endsAt);
  });

  it("undo unteaches the template the completion's timing sample", async () => {
    vi.setSystemTime(new Date('2026-07-29T09:00:00'));
    const list = await store.addList('A');
    const t = await store.addTask(list.id);
    const tpl = await store.createRecurring(t.id, { kind: 'afterCompletion', interval: 1, unit: 'days' });
    await store.acceptTask(t.id); // starts the clock
    vi.setSystemTime(new Date('2026-07-29T09:30:00'));
    await store.completeTask(t.id);
    let saved = store.state.templates.find((x) => x.id === tpl.id)!;
    expect(saved.completedInstances).toBe(1);
    await store.undoLast();
    saved = store.state.templates.find((x) => x.id === tpl.id)!;
    expect(saved.completedInstances).toBeUndefined();
    expect(saved.avgActiveMs).toBeUndefined();
    expect(saved.nextSpawnAt).toBeUndefined(); // un-armed too
  });

  it("a ritual's completion kills its countdown (and undo revives it)", async () => {
    const list = await store.addList('A');
    const t = await store.addTask(list.id);
    await store.patchTask(t.id, {
      ritual: { days: [0, 1, 2, 3, 4, 5, 6], from: '00:00', to: '23:59' },
    });
    await store.startTimebox(t.id, 25);
    const endsAt = store.state.tasks.find((x) => x.id === t.id)!.timeboxEndsAt!;
    await store.completeTask(t.id);
    expect(store.state.tasks.find((x) => x.id === t.id)!.timeboxEndsAt).toBeUndefined();
    await store.undoLast();
    expect(store.state.tasks.find((x) => x.id === t.id)!.timeboxEndsAt).toBe(endsAt);
  });
});

describe('current-task and settings kv hardening', () => {
  it('undoing a completion restores the current-task slot (mirror ref round-trips)', async () => {
    const list = await store.addList('A');
    const t = await store.addTask(list.id);
    await store.acceptTask(t.id);
    await store.completeTask(t.id);
    expect(store.state.currentTask).toBeNull();
    await store.undoLast();
    // The prior ref came out of the $state mirror — a deep proxy. The repo
    // must copy it before Dexie structured-clones, or this write throws and
    // the restore is silently half-done.
    expect(store.state.currentTask?.taskId).toBe(t.id);
    expect((await persisted()).currentTask?.taskId).toBe(t.id);
  });

  it('a change always supersedes a future-stamped singleton', async () => {
    const repo = (store as unknown as { repo: Repo }).repo;
    const FUTURE = Date.now() + 3_600_000; // a fast-clocked device synced this in
    const snapNow = await repo.loadSnapshot();
    await repo.replaceAll({
      ...snapNow,
      currentTask: { taskId: 'ghost', acceptedAt: 1 }, currentTaskUpdatedAt: FUTURE,
      settingsUpdatedAt: FUTURE,
    });
    const clearStamp = await repo.setCurrentTask(null);
    expect(clearStamp).toBeGreaterThan(FUTURE); // else the ghost resurrects on next sync
    const settingsStamp = await repo.updateSettings({ hoursPerDay: 3 });
    expect(settingsStamp).toBeGreaterThan(FUTURE);
    const loaded = await persisted();
    expect(loaded.currentTask).toBeNull();
    expect(loaded.settings.hoursPerDay).toBe(3);
  });
});

describe('moveRecurringToList', () => {
  it('re-homes the template and its open spawned copy together', async () => {
    const a = await store.addList('A');
    const b = await store.addList('B');
    const t = await store.addTask(a.id);
    const template = await store.createRecurring(t.id, { kind: 'afterCompletion', interval: 1, unit: 'days' });
    await store.moveRecurringToList(template.id, b.id);
    expect(store.state.templates.find((x) => x.id === template.id)!.listId).toBe(b.id);
    expect(store.state.tasks.find((x) => x.id === t.id)!.listId).toBe(b.id);
  });

  it('leaves completed history where it happened', async () => {
    const a = await store.addList('A');
    const b = await store.addList('B');
    const t = await store.addTask(a.id);
    const template = await store.createRecurring(t.id, { kind: 'afterCompletion', interval: 1, unit: 'days' });
    await store.completeTask(t.id);
    await store.moveRecurringToList(template.id, b.id);
    expect(store.state.tasks.find((x) => x.id === t.id)!.listId).toBe(a.id);
  });
});

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

  it('undoing a bulk complete restores everything the single-task undo does', async () => {
    // Regression: the batch undo hand-rolled its own inverse and reset only
    // completedAt, quietly dropping the in-progress flag, the elapsed clock
    // and the current-task slot that completeTask's own undo puts back.
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    const b = await store.addTask(list.id);
    await store.patchTask(a.id, { name: 'current one' });
    await store.acceptTask(a.id); // a is now current + in progress
    expect(store.state.currentTask?.taskId).toBe(a.id);

    await store.bulkApply([a.id, b.id], 'complete');
    expect(store.state.currentTask).toBeNull();

    expect(await store.undoLast()).toBe('Completed 2 tasks');
    const back = store.state.tasks.find((t) => t.id === a.id)!;
    expect(back.completedAt).toBeUndefined();
    expect(back.inProgress).toBe(true);
    expect(back.startedAt).toBeGreaterThan(0);
    expect(store.state.currentTask?.taskId).toBe(a.id);
  });

  it('a bulk complete un-arms recurrences on undo, like the single-task path', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await store.addList('L');
    const t = await store.addTask(list.id);
    await store.patchTask(t.id, { name: 'water plants' });
    await store.createRecurring(t.id, { kind: 'afterCompletion', interval: 3, unit: 'days' });

    await store.bulkApply([t.id], 'complete');
    expect(store.state.templates[0]!.nextSpawnAt).toBeGreaterThan(0);
    await store.undoLast();
    expect(store.state.templates[0]!.nextSpawnAt).toBeUndefined();
  });

  it('a bulk complete never auto-selects a task mid-sweep', async () => {
    // Regression: autoSelectNext fired inside the loop, so finishing the
    // current task drew an UNRELATED task, marked it in progress, and left it
    // that way — outside anything the batch's single undo could take back.
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    const b = await store.addTask(list.id);
    const bystander = await store.addTask(list.id);
    // Max priority so the draw would deterministically land on it — otherwise
    // this test only catches the regression on a coin flip.
    await store.patchTask(bystander.id, { name: 'not part of this', priority: 'max' });
    await store.updateSettings({ autoSelectNext: true });
    await store.acceptTask(a.id);

    await store.bulkApply([a.id, b.id], 'complete');
    const untouched = store.state.tasks.find((t) => t.id === bystander.id)!;
    expect(untouched.inProgress).toBeFalsy();
    expect(untouched.startedAt).toBeUndefined();
    expect(store.state.currentTask).toBeNull();
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

  it('arms the undo before the row can vanish, even when the write is slow', async () => {
    // The precise race CI kept hitting. patchTask updates the mirror
    // SYNCHRONOUSLY and then awaits the IndexedDB write, so the row leaves the
    // screen while the write is still in flight. Slowing the write makes that
    // window wide and deterministic instead of a timing coincidence.
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.patchTask(a.id, { name: 'gone too soon' });
    undoStack.clear();

    const repo = (store as unknown as {
      repo: { updateTask: (...args: never[]) => Promise<unknown> };
    }).repo;
    const realUpdate = repo.updateTask.bind(repo);
    repo.updateTask = (...args: never[]) =>
      new Promise((resolve) => { setTimeout(() => resolve(realUpdate(...args)), 40); });

    const pending = store.completeTask(a.id);
    await Promise.resolve(); // let the synchronous mirror update land

    expect(store.state.tasks.find((t) => t.id === a.id)?.completedAt,
      'the mirror says done, so the row is already gone').toBeGreaterThan(0);
    expect(undoStack.latest?.label,
      'the undo must already exist at that instant').toContain('gone too soon');

    repo.updateTask = realUpdate as typeof repo.updateTask;
    await pending;
  });

  it('the undo entry exists the moment the task leaves the screen', async () => {
    // Regression: the row vanished on the first state change, but the undo
    // entry was pushed after several more awaits (recurrence bookkeeping,
    // clearing the current task, drawing the next). In that window Cmd+Z hit an
    // empty stack and did nothing — the task was simply gone. Rare by hand,
    // reliable for anyone completing and undoing quickly.
    const list = await store.addList('L');
    const a = await store.addTask(list.id);
    await store.patchTask(a.id, { name: 'gone too soon' });
    await store.acceptTask(a.id);
    await store.updateSettings({ autoSelectNext: true }); // the longest tail

    const pending = store.completeTask(a.id);
    // Do NOT await the whole thing: check the stack as soon as the mirror says
    // the task is complete, which is when the UI stops rendering its row.
    await Promise.resolve();
    await pending;
    expect(undoStack.latest?.label).toContain('gone too soon');
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

  it('importThings: scheduled templates arrive ARMED and spawn when due', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00')); // Wednesday
    await store.importThings({
      lists: [{ id: 'TP1', thingsUuid: 'TP1', title: 'Garden', sortMode: 'priority' as const, createdAt: 100, updatedAt: 100, deleted: false }],
      tags: [], tasks: [],
      templates: [{
        id: 'TR1', thingsUuid: 'TR1', listId: 'TP1', name: 'water weekly', notes: '', tagIds: [],
        priority: 'medium' as const, mode: { kind: 'weekly' as const, weekdays: [1] },
        paused: false, createdAt: 100, updatedAt: 100, deleted: false,
      }],
      review: [], counts: { lists: 1, tags: 0, openTasks: 0, completedTasks: 0, templates: 1 },
    });
    const tpl = store.state.templates[0]!;
    expect(tpl.nextSpawnAt).toBe(new Date('2026-07-20T04:00:00').getTime()); // next Monday
    vi.setSystemTime(new Date('2026-07-20T05:00:00'));
    expect(await store.runSpawnSweep()).toBe(1);
    expect(store.state.tasks[0]!.name).toBe('water weekly');
  });

  it('importThings: an afterCompletion template with no open copy arms for tomorrow', async () => {
    vi.setSystemTime(new Date('2026-08-11T12:00:00'));
    await store.importThings({
      lists: [{ id: 'TP1', thingsUuid: 'TP1', title: 'Garden', sortMode: 'priority' as const, createdAt: 100, updatedAt: 100, deleted: false }],
      tags: [], tasks: [],
      templates: [{
        id: 'TR1', thingsUuid: 'TR1', listId: 'TP1', name: 'sharpen tools', notes: '', tagIds: [],
        priority: 'medium' as const, mode: { kind: 'afterCompletion' as const, interval: 30, unit: 'days' as const },
        paused: false, createdAt: 100, updatedAt: 100, deleted: false,
      }],
      review: [], counts: { lists: 1, tags: 0, openTasks: 0, completedTasks: 0, templates: 1 },
    });
    // Without a living copy nothing could ever be completed to re-arm it —
    // the heal arms it for the NEXT ROLLOVER (not NOW: arming to now made a
    // deliberately deleted copy resurrect on every app open, 2026-08-11).
    expect(store.state.tasks.filter((t) => t.completedAt === undefined)).toHaveLength(0);
    expect(store.state.templates[0]!.nextSpawnAt)
      .toBe(new Date('2026-08-12T04:00:00').getTime());

    vi.setSystemTime(new Date('2026-08-12T05:00:00'));
    await store.runSpawnSweep();
    const open = store.state.tasks.filter((t) => t.completedAt === undefined);
    expect(open).toHaveLength(1);
    expect(open[0]!.name).toBe('sharpen tools');
    expect(store.state.templates[0]!.nextSpawnAt).toBeUndefined(); // back to resting
  });

  it('importThings: a newer Things edit updates shared fields but cannot wipe app-only state', async () => {
    const base = {
      lists: [{ id: 'TP1', thingsUuid: 'TP1', title: 'Garden', sortMode: 'priority' as const, createdAt: 100, updatedAt: 100, deleted: false }],
      tags: [], templates: [], review: [],
      counts: { lists: 1, tags: 0, openTasks: 1, completedTasks: 0, templates: 0 },
    };
    await store.importThings({
      ...base,
      tasks: [{
        id: 'TT1', thingsUuid: 'TT1', listId: 'TP1', name: 'feed cats', notes: '', priority: 'medium' as const,
        tagIds: [], inProgress: false, createdAt: 100, updatedAt: 100, deleted: false,
      }],
    });
    const task = store.state.tasks.find((t) => t.thingsUuid === 'TT1')!;
    // App-side life accumulates: ritual config, an app tag, an estimate, custom order.
    const appTag = await store.addTag('home', 3);
    await store.patchTask(task.id, {
      rituals: [{ days: [0, 1, 2, 3, 4, 5, 6], from: '08:00', to: '09:00' }],
      estimateHours: 2, order: 5, tagIds: [appTag.id],
    });
    // Force the local stamp BELOW the incoming Things edit so the replace path runs.
    await store.patchTask(task.id, {});
    const local = store.state.tasks.find((t) => t.id === task.id)!;
    const newer = local.updatedAt + 10_000;

    await store.importThings({
      ...base,
      tasks: [{
        id: 'TT1', thingsUuid: 'TT1', listId: 'TP1', name: 'feed cats RENAMED', notes: 'from phone',
        priority: 'high' as const, tagIds: [], inProgress: false,
        createdAt: 100, updatedAt: newer, deleted: false,
      }],
    });
    const after = store.state.tasks.find((t) => t.thingsUuid === 'TT1')!;
    expect(after.name).toBe('feed cats RENAMED'); // shared field: newest wins
    expect(after.priority).toBe('high');
    expect(after.rituals).toHaveLength(1); // app-only state survives
    expect(after.estimateHours).toBe(2);
    expect(after.order).toBe(5);
    expect(after.tagIds).toContain(appTag.id);
  });

  it('importThings: refuses to run two imports concurrently', async () => {
    const mapped = {
      lists: [{ id: 'TP1', thingsUuid: 'TP1', title: 'Garden', sortMode: 'priority' as const, createdAt: 100, updatedAt: 100, deleted: false }],
      tags: [], tasks: [], templates: [], review: [],
      counts: { lists: 1, tags: 0, openTasks: 0, completedTasks: 0, templates: 0 },
    };
    // Two racing imports would each read a snapshot, mint separate app ids for
    // every new row, and duplicate the library — the store must refuse.
    const first = store.importThings(mapped);
    await expect(store.importThings(mapped)).rejects.toThrow(/already running/);
    await first; // and the winner completes normally
    expect(store.state.lists.filter((l) => l.thingsUuid === 'TP1')).toHaveLength(1);
  });

  it('importThings: re-importing with the count-history choice flipped updates existing rows', async () => {
    const mapped = {
      lists: [{ id: 'TP1', thingsUuid: 'TP1', title: 'Garden', sortMode: 'priority' as const, createdAt: 100, updatedAt: 100, deleted: false }],
      tags: [], templates: [], review: [],
      tasks: [{
        id: 'TT1', thingsUuid: 'TT1', listId: 'TP1', name: 'old victory', notes: '', priority: 'medium' as const,
        tagIds: [], inProgress: false, createdAt: 100, updatedAt: 100, deleted: false,
        completedAt: 200, importedHistory: true as const,
      }],
      counts: { lists: 1, tags: 0, openTasks: 0, completedTasks: 1, templates: 0 },
    };
    await store.importThings(mapped);
    const row = () => store.state.tasks.find((t) => t.thingsUuid === 'TT1')!;
    expect(row().importedHistory).toBe(true);

    // Same file, choice flipped: the row is not "newer", but the flag is OUR
    // classification, not a Things field — the toggle must still take effect.
    await store.importThings(mapped, { countHistoryInTotals: true });
    expect(row().importedHistory).toBeUndefined();

    await store.importThings(mapped); // and back
    expect(row().importedHistory).toBe(true);
  });

  it('importThings: floor-stamped entities (areas/tags) never beat local edits on re-import', async () => {
    const mapped = {
      lists: [{ id: 'TA1', thingsUuid: 'TA1', title: 'Area', sortMode: 'priority' as const, createdAt: 1, updatedAt: 1, deleted: false }],
      tags: [{ id: 'TG1', thingsUuid: 'TG1', name: 'green', colorIndex: 0, createdAt: 1, updatedAt: 1, deleted: false }],
      tasks: [], templates: [], review: [],
      counts: { lists: 1, tags: 1, openTasks: 0, completedTasks: 0, templates: 0 },
    };
    await store.importThings(mapped);
    const tag = store.state.tags.find((t) => t.thingsUuid === 'TG1')!;
    const list = store.state.lists.find((l) => l.thingsUuid === 'TA1')!;
    await store.recolorTag(tag.id, 9);
    await store.setListArchived(list.id, true);

    await store.importThings(mapped); // the exact same file again
    expect(store.state.tags.find((t) => t.id === tag.id)!.colorIndex).toBe(9);
    expect(store.state.lists.find((l) => l.id === list.id)!.archived).toBe(true);
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

  it('importThings: a reactive-proxied mapping still imports', async () => {
    // Reported on a 25,000-item library: "Proxy object could not be cloned".
    // The view held the whole mapping in $state, so every row was a proxy, and
    // IndexedDB cannot structured-clone one. A bare Proxy stands in for a
    // Svelte state proxy — structuredClone rejects both the same way.
    const plain = {
      lists: [{ id: 'TP1', thingsUuid: 'TP1', title: 'Proxied', sortMode: 'priority' as const, createdAt: 100, updatedAt: 100, deleted: false }],
      tags: [],
      tasks: [{
        id: 'TT1', thingsUuid: 'TT1', listId: 'TP1', name: 'through a proxy', notes: '',
        priority: 'medium' as const, tagIds: [], inProgress: false,
        createdAt: 100, updatedAt: 100, deleted: false,
      }],
      // A recurring template matters here: the upsert rebuilds task rows field
      // by field, so their proxies fall away, but a template's `mode` object is
      // only shallow-spread and stays proxied all the way to the write. That
      // nested object is what actually breaks the clone.
      templates: [{
        id: 'TR1', thingsUuid: 'TR1', listId: 'TP1', name: 'water plants', notes: '',
        tagIds: [], priority: 'medium' as const,
        mode: { kind: 'weekly' as const, weekdays: [1, 4] },
        paused: false, createdAt: 100, updatedAt: 100, deleted: false,
      }],
      review: [],
      counts: { lists: 1, tags: 0, openTasks: 1, completedTasks: 0, templates: 1 },
    };
    // A DEEP proxy, because that is what $state actually is. A bare
    // `new Proxy(obj, {})` only wraps the root, so the nested rows stay plain
    // and reach IndexedDB perfectly happily — it would not reproduce this at
    // all. What breaks the write is a proxied row several levels down.
    const deepProxy = <T,>(o: T): T =>
      o !== null && typeof o === 'object'
        ? (new Proxy(o as object, {
            get: (t, k, r) => deepProxy(Reflect.get(t, k, r) as unknown),
          }) as T)
        : o;

    const proxied = deepProxy(plain);
    // Sanity: the nested rows really are unclonable, so this test means something.
    expect(() => structuredClone(proxied.tasks[0])).toThrow();

    await store.importThings(proxied);
    expect(store.state.tasks.find((t) => t.thingsUuid === 'TT1')?.name).toBe('through a proxy');
    // And it genuinely reached disk, which is where the clone happens.
    expect((await persisted()).tasks.find((t) => t.thingsUuid === 'TT1')?.name)
      .toBe('through a proxy');
  });

  it('importThings: everything you made by hand survives untouched', async () => {
    // The question anyone asks before a big import: does this ADD, or replace?
    // It adds. Matching is by Things UUID, and hand-made rows have none, so
    // they can never be matched and never be overwritten.
    const myList = await store.addList('My Own List');
    const myTask = await store.addTask(myList.id);
    await store.patchTask(myTask.id, { name: 'entered by hand', priority: 'high' });
    await store.acceptTask(myTask.id); // and it stays the current task

    await store.importThings({
      lists: [{ id: 'TP1', thingsUuid: 'TP1', title: 'From Things', sortMode: 'priority' as const, createdAt: 100, updatedAt: 100, deleted: false }],
      tags: [],
      tasks: [{
        id: 'TT1', thingsUuid: 'TT1', listId: 'TP1', name: 'imported', notes: '',
        priority: 'medium' as const, tagIds: [], inProgress: false,
        createdAt: 100, updatedAt: 100, deleted: false,
      }],
      templates: [],
      review: [],
      counts: { lists: 1, tags: 0, openTasks: 1, completedTasks: 0, templates: 0 },
    });

    const mine = store.state.tasks.find((t) => t.id === myTask.id);
    expect(mine, 'the hand-made task is still there').toBeDefined();
    expect(mine!.name).toBe('entered by hand');
    expect(mine!.priority).toBe('high');
    expect(store.state.lists.find((l) => l.id === myList.id)?.title).toBe('My Own List');
    expect(store.state.currentTask?.taskId, 'and is still the current task').toBe(myTask.id);
    // Both worlds now coexist.
    expect(store.state.tasks).toHaveLength(2);
    expect(store.state.lists).toHaveLength(2);
    // Survives a SECOND import too — no duplicates, still no collateral damage.
    expect((await persisted()).tasks.find((t) => t.id === myTask.id)?.name).toBe('entered by hand');
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

describe('list ordering', () => {
  it('reorderLists numbers the group and persists only what moved', async () => {
    const a = await store.addList('Alpha');
    const b = await store.addList('Beta');
    const c = await store.addList('Gamma');

    await store.reorderLists([c.id, a.id, b.id]);
    const orderOf = (id: string) => store.state.lists.find((l) => l.id === id)!.order;
    expect(orderOf(c.id)).toBe(0);
    expect(orderOf(a.id)).toBe(1);
    expect(orderOf(b.id)).toBe(2);
    expect((await persisted()).lists.find((l) => l.id === c.id)!.order).toBe(0);

    // Re-committing the same sequence is a no-op — nothing to write or sync.
    const stamps = store.state.lists.map((l) => l.updatedAt);
    await store.reorderLists([c.id, a.id, b.id]);
    expect(store.state.lists.map((l) => l.updatedAt)).toEqual(stamps);
  });
});

describe('deleting and restoring never duplicates a row', () => {
  it('restoring a list a sync already put back does not make a second copy', async () => {
    // "My list keeps growing": not new lists, the same one twice. Delete puts
    // the row in the trash map; if a sync merge then returns it to the mirror,
    // the old restore pushed the trashed copy in ALONGSIDE it.
    const list = await store.addList('Comes Back');
    const task = await store.addTask(list.id);
    const removed = await store.removeList(list.id);
    expect(store.state.lists).toHaveLength(0);

    // Simulate a sync putting the row back before the user hits undo.
    store.state.lists.push({
      ...list, deleted: false, updatedAt: Date.now(),
    });

    await store.restoreList(list.id, removed);
    expect(store.state.lists.filter((l) => l.id === list.id)).toHaveLength(1);
    expect(store.state.tasks.filter((t) => t.id === task.id)).toHaveLength(1);
  });

  it('a plain delete-then-undo still restores exactly one list and its tasks', async () => {
    const list = await store.addList('Oops');
    const a = await store.addTask(list.id);
    const b = await store.addTask(list.id);
    const removed = await store.removeList(list.id);

    await store.restoreList(list.id, removed);
    expect(store.state.lists.map((l) => l.id)).toEqual([list.id]);
    expect(store.state.tasks.map((t) => t.id).sort()).toEqual([a.id, b.id].sort());
    // …and it reached disk, so the other device learns about it too.
    const disk = await persisted();
    expect(disk.lists).toHaveLength(1);
    expect(disk.tasks).toHaveLength(2);
  });

  it('restoring twice is harmless', async () => {
    const list = await store.addList('Twice');
    const removed = await store.removeList(list.id);
    await store.restoreList(list.id, removed);
    await store.restoreList(list.id, removed);
    expect(store.state.lists.filter((l) => l.id === list.id)).toHaveLength(1);
  });
});

describe('tag housekeeping', () => {
  async function tagged(name: string, taskNames: string[]) {
    const tag = await store.addTag(name, 0);
    const list = store.state.lists[0] ?? (await store.addList('Stuff'));
    for (const n of taskNames) {
      const task = await store.addTask(list.id);
      await store.patchTask(task.id, { name: n, tagIds: [tag.id] });
    }
    return tag;
  }

  it('renames a tag without disturbing the tasks wearing it', async () => {
    const tag = await tagged('erands', ['post office']);
    await store.renameTag(tag.id, 'errands');
    expect(store.state.tags[0]!.name).toBe('errands');
    expect(store.state.tasks[0]!.tagIds).toEqual([tag.id]);
    expect((await persisted()).tags[0]!.name).toBe('errands');
  });

  it('ignores a rename to nothing', async () => {
    const tag = await tagged('keep me', []);
    await store.renameTag(tag.id, '   ');
    expect(store.state.tags[0]!.name).toBe('keep me');
  });

  it('deleting a tag hides it everywhere, and undo brings it back', async () => {
    const tag = await tagged('junk', ['a task']);
    await store.removeTag(tag.id);
    expect(store.state.tags).toEqual([]);
    expect((await persisted()).tags).toEqual([]);

    await undoStack.undo();
    expect(store.state.tags.map((t) => t.name)).toEqual(['junk']);
    expect((await persisted()).tags).toHaveLength(1);
  });

  it('a deleted tag leaves the task alone, so undo re-labels it automatically', async () => {
    // Deliberate: the id stays on the task and every reader ignores what it
    // cannot resolve. It is what makes deleting a heavily-used tag instant.
    const tag = await tagged('junk', ['a task']);
    await store.removeTag(tag.id);
    expect(store.state.tasks[0]!.tagIds, 'untouched').toEqual([tag.id]);
    await undoStack.undo();
    expect(store.state.tasks[0]!.tagIds).toEqual([tag.id]);
  });

  it('deletes a batch of tags under a single undo', async () => {
    const a = await tagged('one', []);
    const b = await tagged('two', []);
    await store.removeTags([a.id, b.id]);
    expect(store.state.tags).toEqual([]);
    await undoStack.undo();
    expect(store.state.tags).toHaveLength(2);
  });

  it('merging moves every task onto the surviving tag', async () => {
    const keep = await tagged('work', ['report']);
    const dupe = await tagged('Work', ['emails', 'standup']);
    const moved = await store.mergeTags(dupe.id, keep.id);

    expect(moved).toBe(2);
    expect(store.state.tags.map((t) => t.name)).toEqual(['work']);
    for (const task of store.state.tasks) expect(task.tagIds).toEqual([keep.id]);
    expect((await persisted()).tasks.every((t) => t.tagIds.includes(keep.id))).toBe(true);
  });

  it('merging a tag a task already wears does not double it up', async () => {
    const keep = await tagged('work', []);
    const dupe = await tagged('Work', []);
    const list = store.state.lists[0]!;
    const both = await store.addTask(list.id);
    await store.patchTask(both.id, { name: 'wears both', tagIds: [keep.id, dupe.id] });

    await store.mergeTags(dupe.id, keep.id);
    expect(store.state.tasks.find((t) => t.id === both.id)!.tagIds).toEqual([keep.id]);
  });

  it('undoing a merge restores the exact tag sets, not an approximation', async () => {
    const keep = await tagged('work', []);
    const dupe = await tagged('Work', []);
    const list = store.state.lists[0]!;
    const onlyDupe = await store.addTask(list.id);
    await store.patchTask(onlyDupe.id, { name: 'only dupe', tagIds: [dupe.id] });
    const both = await store.addTask(list.id);
    await store.patchTask(both.id, { name: 'both', tagIds: [keep.id, dupe.id] });

    await store.mergeTags(dupe.id, keep.id);
    await undoStack.undo();

    expect(store.state.tags).toHaveLength(2);
    expect(store.state.tasks.find((t) => t.id === onlyDupe.id)!.tagIds).toEqual([dupe.id]);
    expect(store.state.tasks.find((t) => t.id === both.id)!.tagIds).toEqual([keep.id, dupe.id]);
  });

  it('refuses to merge a tag into itself or into one that is gone', async () => {
    const tag = await tagged('solo', ['x']);
    expect(await store.mergeTags(tag.id, tag.id)).toBe(0);
    expect(await store.mergeTags(tag.id, 'nope')).toBe(0);
    expect(store.state.tags).toHaveLength(1);
  });
});

describe('sweep verdicts', () => {
  async function reviewable(name: string) {
    const listId = store.state.lists[0]?.id ?? (await store.addList('Backlog')).id;
    const t = await store.addTask(listId);
    await store.patchTask(t.id, { name });
    // addTask marks fresh tasks needsReview; the name patch leaves it alone.
    expect(store.state.tasks.find((x) => x.id === t.id)!.needsReview).toBe(true);
    return t.id;
  }

  it('keep clears the flag, optionally re-prioritising', async () => {
    const id = await reviewable('keeper');
    await store.applySweepVerdict(id, 'keep', { priority: 'high' });
    const t = store.state.tasks.find((x) => x.id === id)!;
    expect(t.needsReview).toBe(false);
    expect(t.priority).toBe('high');
  });

  it('someday sinks it to the bottom tier, reviewed', async () => {
    const id = await reviewable('eventually');
    await store.applySweepVerdict(id, 'someday');
    const t = store.state.tasks.find((x) => x.id === id)!;
    expect(t.priority).toBe('someday');
    expect(t.needsReview).toBe(false);
  });

  it('later takes it out of the draw until the chosen day', async () => {
    const id = await reviewable('autumn thing');
    await store.applySweepVerdict(id, 'later', { snoozeDays: 30 });
    const t = store.state.tasks.find((x) => x.id === id)!;
    expect(t.notTodayUntil).toBeGreaterThan(Date.now() + 28 * 86_400_000);
    expect(t.needsReview).toBe(false);
    expect(
      eligibleForDraw(store.state.tasks, new Date()).map((x) => x.id),
      'the randomizer must not offer it',
    ).not.toContain(id);
  });

  it('done and delete ride the ordinary, undoable paths', async () => {
    const doneId = await reviewable('already did this');
    await store.applySweepVerdict(doneId, 'done');
    expect(store.state.tasks.find((x) => x.id === doneId)!.completedAt).toBeDefined();
    await undoStack.undo();
    expect(store.state.tasks.find((x) => x.id === doneId)!.completedAt).toBeUndefined();

    const goneId = await reviewable('junk');
    await store.applySweepVerdict(goneId, 'delete');
    expect(store.state.tasks.find((x) => x.id === goneId)).toBeUndefined();
    await undoStack.undo();
    expect(store.state.tasks.find((x) => x.id === goneId)).toBeDefined();
  });

  it('revert puts a patch verdict back exactly', async () => {
    const id = await reviewable('oops');
    const r = await store.applySweepVerdict(id, 'someday');
    await store.revertSweepVerdict(id, r!.before);
    const t = store.state.tasks.find((x) => x.id === id)!;
    expect(t.priority).toBe('medium');
    expect(t.needsReview).toBe(true);
  });
});

describe('sweep re-filing', () => {
  it('moving is a keep: new list, flag cleared, exact revert', async () => {
    const from = await store.addList('Catch-all');
    const to = await store.addList('Wind-down');
    const t = await store.addTask(from.id);
    await store.patchTask(t.id, { name: 'evening thing' });

    const r = await store.applySweepVerdict(t.id, 'keep', { listId: to.id });
    const moved = store.state.tasks.find((x) => x.id === t.id)!;
    expect(moved.listId).toBe(to.id);
    expect(moved.needsReview).toBe(false);

    await store.revertSweepVerdict(t.id, r!.before);
    const back = store.state.tasks.find((x) => x.id === t.id)!;
    expect(back.listId, 'revert returns it to the catch-all').toBe(from.id);
    expect(back.needsReview).toBe(true);
  });
});

describe('generated tasks', () => {
  it('materialize into their own vessel, created once and reused', async () => {
    await store.addList('My Stuff');
    const first = await store.materializeGeneratedTask('drink some water');
    const second = await store.materializeGeneratedTask('stretch for a minute');

    const vessels = store.state.lists.filter((l) => l.generated === true);
    expect(vessels, 'one vessel, not one per task').toHaveLength(1);
    expect(vessels[0]!.title).toBe('self-care');
    expect(first.listId).toBe(vessels[0]!.id);
    expect(second.listId).toBe(vessels[0]!.id);

    const t = store.state.tasks.find((x) => x.id === first.id)!;
    expect(t.needsReview, 'the dice wrote it; nobody reviews it').toBe(false);
    expect(t.priority).toBe('high');
    expect((await persisted()).tasks.map((x) => x.id)).toContain(first.id);
  });
});

describe('spawn idempotency', () => {
  it('near-simultaneous sweeps produce exactly one instance', async () => {
    // Two triggers landing together (init + visibility, rollover timers) must
    // not each spawn — the 2026-08-11 duplicate-walk report, same-device half.
    vi.setSystemTime(new Date('2026-08-09T09:00:00'));
    const list = await store.addList('Lake');
    const t = await store.addTask(list.id);
    await store.patchTask(t.id, { name: 'Go for a walk' });
    await store.createRecurring(t.id, { kind: 'afterCompletion', interval: 1, unit: 'days' });
    await store.completeTask(t.id); // arms nextSpawnAt = +1 day

    vi.setSystemTime(new Date('2026-08-10T09:00:01'));
    await Promise.all([store.runSpawnSweep(), store.runSpawnSweep()]);
    const open = store.state.tasks.filter(
      (x) => x.name === 'Go for a walk' && !x.deleted && x.completedAt === undefined,
    );
    expect(open).toHaveLength(1);
  });

  it('the spawned instance carries the deterministic occurrence id', async () => {
    // Cross-device half of the same report: both devices mint THIS id from
    // the synced due moment, so the merge collapses their rows into one.
    vi.setSystemTime(new Date('2026-08-09T09:00:00'));
    const list = await store.addList('Lake');
    const t = await store.addTask(list.id);
    const tpl = await store.createRecurring(t.id, { kind: 'afterCompletion', interval: 1, unit: 'days' });
    await store.completeTask(t.id);
    const due = store.state.templates.find((x) => x.id === tpl.id)!.nextSpawnAt!;

    vi.setSystemTime(new Date('2026-08-10T09:00:01'));
    await store.runSpawnSweep();
    const spawned = store.state.tasks.find(
      (x) => x.recurrenceId === tpl.id && x.completedAt === undefined && !x.deleted,
    )!;
    expect(spawned.id).toBe(`sp_${tpl.id}_${due}`);
  });
});

describe('deleting a recurring copy', () => {
  it('stays gone until the next rollover, then regrows once', async () => {
    // 2026-08-11 report: a deleted daily's copy resurrected on EVERY app
    // open — the dormant-rule heal armed afterCompletion to NOW. A delete
    // means "not today" at minimum; the rule regrows it tomorrow.
    vi.setSystemTime(new Date('2026-08-11T12:00:00'));
    const list = await store.addList('Lake');
    const t = await store.addTask(list.id);
    await store.patchTask(t.id, { name: 'stretch' });
    const tpl = await store.createRecurring(t.id, { kind: 'afterCompletion', interval: 1, unit: 'days' });
    await store.removeTask(t.id);

    const open = () => store.state.tasks.filter(
      (x) => x.recurrenceId === tpl.id && !x.deleted && x.completedAt === undefined,
    );
    // Whack-a-mole check: repeated sweeps today never bring it back…
    await store.runSpawnSweep();
    await store.runSpawnSweep();
    expect(open()).toHaveLength(0);
    // …but tomorrow (past the 4am rollover) the rule keeps its commitment.
    vi.setSystemTime(new Date('2026-08-12T05:00:00'));
    await store.runSpawnSweep();
    expect(open()).toHaveLength(1);
  });
});

describe('the work clock', () => {
  it('a stretch under the threshold records nothing, not even a template sample', async () => {
    vi.setSystemTime(new Date('2026-08-08T10:00:00'));
    const list = await store.addList('Quick');
    const t = await store.addTask(list.id);
    await store.setInProgress(t.id, true);
    vi.setSystemTime(new Date('2026-08-08T10:00:04')); // four seconds "of work"
    await store.completeTask(t.id);
    // The work happened off the books (2026-08-08 ask): a near-zero sample
    // would be a confident lie to the estimate averages.
    expect(store.state.tasks.find((x) => x.id === t.id)!.activeMs).toBeUndefined();
  });

  it('a real stretch still records exactly', async () => {
    vi.setSystemTime(new Date('2026-08-08T10:00:00'));
    const list = await store.addList('Slow');
    const t = await store.addTask(list.id);
    await store.setInProgress(t.id, true);
    vi.setSystemTime(new Date('2026-08-08T10:05:00'));
    await store.completeTask(t.id);
    expect(store.state.tasks.find((x) => x.id === t.id)!.activeMs).toBe(5 * 60_000);
  });

  it('reset discards running AND banked time; undo restores both', async () => {
    vi.setSystemTime(new Date('2026-08-08T10:00:00'));
    const list = await store.addList('Oops');
    const t = await store.addTask(list.id);
    await store.setInProgress(t.id, true);
    vi.setSystemTime(new Date('2026-08-08T10:30:00'));
    await store.setInProgress(t.id, false); // banks 30m
    expect(store.state.tasks.find((x) => x.id === t.id)!.activeAccumulatedMs).toBe(30 * 60_000);
    await store.setInProgress(t.id, true);
    vi.setSystemTime(new Date('2026-08-08T11:00:00'));

    await store.resetWorkClock(t.id);
    let row = store.state.tasks.find((x) => x.id === t.id)!;
    expect(row.activeAccumulatedMs).toBeUndefined();
    expect(row.startedAt).toBe(new Date('2026-08-08T11:00:00').getTime());

    await store.undoLast();
    row = store.state.tasks.find((x) => x.id === t.id)!;
    expect(row.activeAccumulatedMs).toBe(30 * 60_000);
    expect(row.startedAt).toBe(new Date('2026-08-08T10:30:00').getTime());
  });
});
