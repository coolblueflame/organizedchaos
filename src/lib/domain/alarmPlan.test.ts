import { describe, expect, it } from 'vitest';
import { alarmBody, alarmPlan, type AlarmRecord } from './alarmPlan';
import type { Priority, Task } from './types';

const rec = (at: number): AlarmRecord => ({ at, confirmed: true });
const NOW = 1_800_000_000_000;
let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${n++}`, listId: 'L1', name: 'boxed', notes: '', tagIds: [],
  priority: 'medium' as Priority, inProgress: false,
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

describe('alarmPlan', () => {
  it('schedules a box the server has not heard about', () => {
    const t = task({ timeboxEndsAt: NOW + 60_000 });
    const plan = alarmPlan([t], new Map(), NOW);
    expect(plan.schedule).toEqual([{ taskId: t.id, at: NOW + 60_000, name: 'boxed' }]);
    expect(plan.cancel).toEqual([]);
  });

  it('says nothing when the server is already correct', () => {
    const t = task({ timeboxEndsAt: NOW + 60_000 });
    const plan = alarmPlan([t], new Map([[t.id, { at: NOW + 60_000, confirmed: true }]]), NOW);
    expect(plan.schedule).toEqual([]);
    expect(plan.cancel).toEqual([]);
  });

  it('reschedules when the box is moved', () => {
    const t = task({ timeboxEndsAt: NOW + 120_000 });
    const plan = alarmPlan([t], new Map([[t.id, { at: NOW + 60_000, confirmed: true }]]), NOW);
    expect(plan.schedule).toHaveLength(1);
    expect(plan.schedule[0]!.at).toBe(NOW + 120_000);
  });

  it('cancels when the box is cleared, completed, or deleted', () => {
    // Each of these is a different call site in the store; the diff catches
    // all of them without any of them knowing the scheduler exists.
    const cleared = task({ timeboxEndsAt: undefined });
    const done = task({ timeboxEndsAt: NOW + 60_000, completedAt: NOW });
    const gone = task({ timeboxEndsAt: NOW + 60_000, deleted: true });
    const scheduled = new Map([[cleared.id, rec(NOW + 1)], [done.id, rec(NOW + 1)], [gone.id, rec(NOW + 1)]]);
    const plan = alarmPlan([cleared, done, gone], scheduled, NOW);
    expect(plan.schedule).toEqual([]);
    expect(plan.cancel.sort()).toEqual([cleared.id, done.id, gone.id].sort());
  });

  it('cancels a box for a task that vanished entirely', () => {
    const plan = alarmPlan([], new Map([['ghost', { at: NOW + 60_000, confirmed: true }]]), NOW);
    expect(plan.cancel).toEqual(['ghost']);
  });

  it('ignores boxes that already expired — the local watcher owns those', () => {
    const t = task({ timeboxEndsAt: NOW - 1 });
    const plan = alarmPlan([t], new Map(), NOW);
    expect(plan.schedule).toEqual([]);
  });

  it('an unconfirmed attempt is retried while live, and cancelled once finished', () => {
    // A keepalive POST can land on the server after the page stops listening
    // for the answer. Both halves of that record matter: keep trying to
    // schedule it, and never lose the right to take it back.
    const t = task({ timeboxEndsAt: NOW + 60_000 });
    const unconfirmed = new Map([[t.id, { at: NOW + 60_000, confirmed: false }]]);
    expect(alarmPlan([t], unconfirmed, NOW).schedule, 'still owed a confirmation')
      .toHaveLength(1);

    const finished = { ...t, timeboxEndsAt: undefined, completedAt: NOW + 1000 };
    expect(alarmPlan([finished], unconfirmed, NOW + 1000).cancel, 'cancellable anyway')
      .toEqual([t.id]);
  });

  it('is idempotent: applying it leaves nothing more to do', () => {
    const a = task({ timeboxEndsAt: NOW + 60_000 });
    const b = task({ timeboxEndsAt: NOW + 90_000 });
    const ledger = new Map<string, AlarmRecord>();
    const first = alarmPlan([a, b], ledger, NOW);
    // Applying the plan = the sends landed and the server confirmed them.
    for (const s of first.schedule) ledger.set(s.taskId, { at: s.at, confirmed: true });
    expect(alarmPlan([a, b], ledger, NOW)).toEqual({ schedule: [], cancel: [] });
  });
});

describe('alarmBody', () => {
  it('names the task, unless its list is locked', () => {
    // Same rule as the local alarm: this lands on a lock screen, where the
    // app's PIN cannot reach.
    expect(alarmBody('call the dentist', false)).toContain('call the dentist');
    expect(alarmBody('call the dentist', true)).not.toContain('dentist');
  });

  it('has something to say about an unnamed task', () => {
    expect(alarmBody('', false)).toContain('your task');
  });
});
