import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type List, type Priority, type Task } from './types';
import { projectPriorities, projectPriority, remainingEstimateHours } from './project';
import { drawTask } from './randomizer';

const now = new Date('2026-07-15T12:00:00');
const settings = { ...DEFAULT_SETTINGS };

const list = (over: Partial<List> = {}): List => ({
  id: 'P', title: 'Project', sortMode: 'priority',
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'P', name: `task-${n}`, notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

describe('remainingEstimateHours', () => {
  it('sums open tasks only, defaulting a missing estimate to an hour', () => {
    const tasks = [
      task({ priority: 'low', estimateHours: 4 }),
      task({ priority: 'low' }),                                    // → 1
      task({ priority: 'low', estimateHours: 8, completedAt: 5 }),  // done, ignored
      { ...task({ priority: 'low', estimateHours: 9 }), deleted: true },
      task({ priority: 'low', estimateHours: 2, listId: 'OTHER' }), // other list
    ];
    expect(remainingEstimateHours(tasks, 'P')).toBe(5);
  });
});

describe('projectPriority', () => {
  it('is null without a deadline or with nothing left to do', () => {
    expect(projectPriority(list(), [task({ priority: 'low' })], settings, now)).toBeNull();
    expect(projectPriority(list({ deadline: '2026-08-01' }), [], settings, now)).toBeNull();
  });

  it('escalates on TOTAL remaining work, not per task', () => {
    // 10 one-hour tasks, 30 days out: individually trivial, collectively fine.
    const many = Array.from({ length: 10 }, () => task({ priority: 'low' }));
    expect(projectPriority(list({ deadline: '2026-08-14' }), many, settings, now)).toBe('low');

    // Same 10 tasks due in 11 days: 10h of work, 1h/day → 1 day of slack → high.
    expect(projectPriority(list({ deadline: '2026-07-26' }), many, settings, now)).toBe('high');

    // Due in 5 days: no slack at all → max.
    expect(projectPriority(list({ deadline: '2026-07-20' }), many, settings, now)).toBe('max');
  });

  it('relaxes as tasks get completed', () => {
    const tasks = Array.from({ length: 10 }, () => task({ priority: 'low' }));
    const due = list({ deadline: '2026-07-26' });
    expect(projectPriority(due, tasks, settings, now)).toBe('high');
    // knock six off → 4h left, 11 days → 7 days slack → low
    for (let i = 0; i < 6; i++) tasks[i]!.completedAt = 1;
    expect(projectPriority(due, tasks, settings, now)).toBe('low');
  });

  it('projectPriorities maps only the lists under pressure', () => {
    const withDeadline = list({ id: 'A', deadline: '2026-07-20' });
    const without = list({ id: 'B' });
    const tasks = [task({ priority: 'low', listId: 'A' }), task({ priority: 'low', listId: 'B' })];
    const map = projectPriorities([withDeadline, without], tasks, settings, now);
    // A: 1h of work, 5 days out → 4 days of slack → medium band
    expect(map.get('A')).toBe('medium');
    expect(map.has('B')).toBe(false);
  });
});

describe('draw with project pressure', () => {
  it('lifts a whole list into the top tier when the project is tight', () => {
    const projectTask = task({ priority: 'low', listId: 'A' });
    const looseTask = task({ priority: 'medium', listId: 'B' });
    const tiers = new Map<string, Priority>([['A', 'max']]);
    for (let i = 0; i < 10; i++) {
      expect(drawTask([projectTask, looseTask], settings, now, Math.random, undefined, tiers)!.id)
        .toBe(projectTask.id);
    }
  });

  it('but a task that is max in its own right is drawn before a lifted one', () => {
    const lifted = task({ priority: 'low', listId: 'A' });
    const genuinelyUrgent = task({ priority: 'max', listId: 'A' });
    const tiers = new Map<string, Priority>([['A', 'max']]);
    for (let i = 0; i < 10; i++) {
      expect(drawTask([lifted, genuinelyUrgent], settings, now, Math.random, undefined, tiers)!.id)
        .toBe(genuinelyUrgent.id);
    }
  });

  it('falls back to lifted tasks once the intrinsic ones are gone', () => {
    const lifted = task({ priority: 'low', listId: 'A' });
    const tiers = new Map<string, Priority>([['A', 'max']]);
    expect(drawTask([lifted], settings, now, Math.random, undefined, tiers)!.id).toBe(lifted.id);
  });
});
