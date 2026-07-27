import { describe, expect, it } from 'vitest';
import type { Priority, Task } from './types';
import { regroupPatch } from './regroup';

let n = 0;
const task = (over: Partial<Task> & { priority: Priority } = { priority: 'medium' }): Task => ({
  id: `t${n++}`, listId: 'L', name: 'task', notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

describe('regroupPatch — priority view', () => {
  it('adopts the dropped-on tier', () => {
    expect(regroupPatch(task({ priority: 'low' }), 'priority', 'max')?.patch).toEqual({ priority: 'max' });
  });

  it('is a no-op on its own tier, and ignores nonsense keys', () => {
    expect(regroupPatch(task({ priority: 'high' }), 'priority', 'high')).toBeNull();
    expect(regroupPatch(task(), 'priority', 'bogus')).toBeNull();
  });
});

describe('regroupPatch — tag view', () => {
  it('adds the tag without dropping existing ones', () => {
    const t = task({ priority: 'low', tagIds: ['a'] });
    expect(regroupPatch(t, 'tag', 'b', 'errands')?.patch).toEqual({ tagIds: ['a', 'b'] });
  });

  it('dropping on Untagged clears tags; already-tagged is a no-op', () => {
    expect(regroupPatch(task({ priority: 'low', tagIds: ['a'] }), 'tag', 'untagged')?.patch)
      .toEqual({ tagIds: [] });
    expect(regroupPatch(task({ priority: 'low' }), 'tag', 'untagged')).toBeNull();
    expect(regroupPatch(task({ priority: 'low', tagIds: ['a'] }), 'tag', 'a')).toBeNull();
  });
});

describe('regroupPatch — date view', () => {
  it('adopts a real date and can clear one', () => {
    expect(regroupPatch(task(), 'date', '2026-08-01')?.patch).toEqual({ deadline: '2026-08-01' });
    expect(regroupPatch(task({ priority: 'low', deadline: '2026-08-01' }), 'date', 'none')?.patch)
      .toEqual({ deadline: undefined });
  });

  it('refuses the computed Overdue bucket and same-date drops', () => {
    expect(regroupPatch(task(), 'date', 'overdue')).toBeNull();
    expect(regroupPatch(task({ priority: 'low', deadline: '2026-08-01' }), 'date', '2026-08-01')).toBeNull();
  });
});
