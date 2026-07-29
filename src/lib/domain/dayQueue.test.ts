import { describe, expect, it } from 'vitest';
import type { Priority, Task } from './types';
import { liveQueueIds } from './dayQueue';

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
