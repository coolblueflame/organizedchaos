import { describe, expect, it } from 'vitest';
import { archivedTaskIds, withoutArchived } from './archive';
import { sweepQueue } from './sweep';
import type { List, Task } from './types';

const list = (title: string, over: Partial<List> = {}): List =>
  ({ id: `L-${title}`, title, sortMode: 'priority', createdAt: 0, updatedAt: 0, deleted: false, ...over });

let n = 0;
const task = (listId: string, over: Partial<Task> = {}): Task => ({
  id: `t${n++}`, listId, name: 'x', notes: '', tagIds: [], priority: 'medium',
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

describe('archive', () => {
  const live = list('Live');
  const shelf = list('Shelf', { archived: true });

  it('collects the open tasks the randomizer must not propose', () => {
    const a = task(shelf.id);
    const ids = archivedTaskIds([a, task(live.id), task(shelf.id, { completedAt: 1 })], [live, shelf]);
    expect(ids).toEqual([a.id]);
  });

  it('strips archived lists from the global views wholesale', () => {
    const kept = task(live.id);
    expect(withoutArchived([kept, task(shelf.id)], [live, shelf])).toEqual([kept]);
  });

  it('the sweep skips archived lists entirely — archiving IS the verdict', () => {
    const queue = sweepQueue(
      [task(live.id, { needsReview: true }), task(shelf.id, { needsReview: true })],
      [live, shelf],
    );
    expect(queue.map((t) => t.listId)).toEqual([live.id]);
  });

  it('no archived lists means no work at all', () => {
    const tasks = [task(live.id)];
    expect(withoutArchived(tasks, [live])).toBe(tasks); // same reference — zero cost
  });
});
