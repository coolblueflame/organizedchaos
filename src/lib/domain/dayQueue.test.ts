import { describe, expect, it } from 'vitest';
import type { Priority, Task } from './types';
import { displayQueue, liveQueueIds, mergeReorder } from './dayQueue';

let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'L1', name: 'task', notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

describe('liveQueueIds', () => {
  it('keeps only ids that resolve to live, open tasks, in queue order', () => {
    const open = task({ priority: 'low' });
    const done = task({ priority: 'low', completedAt: 5 });
    const gone = task({ priority: 'low', deleted: true });
    const ids = liveQueueIds([done.id, 'missing', open.id, gone.id], [open, done, gone]);
    expect(ids).toEqual([open.id]);
  });

  it('an empty queue stays empty', () => {
    expect(liveQueueIds([], [task({ priority: 'low' })])).toEqual([]);
  });
});

describe('displayQueue', () => {
  const NOW = 1_800_000_000_000;

  it('shows what can still be drawn today first, then the snoozed, each in queue order', () => {
    const a = task({ priority: 'low', notTodayUntil: NOW + 3_600_000 });
    const b = task({ priority: 'low' });
    const c = task({ priority: 'low', notTodayUntil: NOW + 60_000 });
    const d = task({ priority: 'low' });
    const { active, snoozed } = displayQueue([a, b, c, d], NOW);
    expect(active.map((x) => x.id)).toEqual([b.id, d.id]);
    expect(snoozed.map((x) => x.id)).toEqual([a.id, c.id]);
  });

  it('a snooze that has lifted puts the task back in its own place', () => {
    const a = task({ priority: 'low', notTodayUntil: NOW - 1 }); // yesterday's "not today"
    const b = task({ priority: 'low' });
    const { active, snoozed } = displayQueue([a, b], NOW);
    expect(active.map((x) => x.id)).toEqual([a.id, b.id]);
    expect(snoozed).toEqual([]);
  });
});

describe('mergeReorder', () => {
  it('applies the new order to the draggable ids and leaves every other id at its index', () => {
    // s1 and s2 are snoozed (shown at the bottom, not draggable); the user
    // dragged c above a among the active rows.
    const stored = ['a', 's1', 'b', 'c', 's2'];
    expect(mergeReorder(stored, ['c', 'a', 'b'])).toEqual(['c', 's1', 'a', 'b', 's2']);
  });

  it('an unchanged order is a no-op', () => {
    const stored = ['a', 's1', 'b'];
    expect(mergeReorder(stored, ['a', 'b'])).toEqual(stored);
  });
});
