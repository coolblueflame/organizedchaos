import { describe, expect, it } from 'vitest';
import { moveWithin, reorderPatches, sortLists } from './listOrder';
import type { List } from './types';

const list = (id: string, order?: number): List => ({
  id, title: id, sortMode: 'priority', createdAt: 0, updatedAt: 0, deleted: false,
  ...(order === undefined ? {} : { order }),
});

describe('sortLists', () => {
  it('leaves an untouched group exactly as it was', () => {
    const input = [list('a'), list('b'), list('c')];
    expect(sortLists(input).map((l) => l.id)).toEqual(['a', 'b', 'c']);
  });

  it('honours explicit order', () => {
    const input = [list('a', 2), list('b', 0), list('c', 1)];
    expect(sortLists(input).map((l) => l.id)).toEqual(['b', 'c', 'a']);
  });

  it('puts a list dragged to the top above ones never dragged', () => {
    // The half-ordered case: treating "no order" as 0 would tie with the
    // pinned list and leave the outcome to sort stability.
    const input = [list('old1'), list('old2'), list('pinned', 0)];
    expect(sortLists(input).map((l) => l.id)).toEqual(['pinned', 'old1', 'old2']);
  });

  it('does not mutate its input', () => {
    const input = [list('a', 1), list('b', 0)];
    sortLists(input);
    expect(input.map((l) => l.id)).toEqual(['a', 'b']);
  });
});

describe('reorderPatches', () => {
  it('numbers the whole group, not just what moved', () => {
    const lists = [list('a'), list('b'), list('c')];
    expect(reorderPatches(['c', 'a', 'b'], lists))
      .toEqual([{ id: 'c', order: 0 }, { id: 'a', order: 1 }, { id: 'b', order: 2 }]);
  });

  it('writes nothing when the sequence is already correct', () => {
    const lists = [list('a', 0), list('b', 1)];
    expect(reorderPatches(['a', 'b'], lists)).toEqual([]);
  });

  it('ignores ids that are not in the group', () => {
    expect(reorderPatches(['ghost', 'a'], [list('a')])).toEqual([{ id: 'a', order: 1 }]);
  });
});

describe('moveWithin', () => {
  it('moves an item to a new index', () => {
    expect(moveWithin(['a', 'b', 'c'], 'c', 0)).toEqual(['c', 'a', 'b']);
    expect(moveWithin(['a', 'b', 'c'], 'a', 2)).toEqual(['b', 'c', 'a']);
  });

  it('clamps out-of-range targets and ignores unknown ids', () => {
    expect(moveWithin(['a', 'b'], 'a', 99)).toEqual(['b', 'a']);
    expect(moveWithin(['a', 'b'], 'a', -5)).toEqual(['a', 'b']);
    expect(moveWithin(['a', 'b'], 'zz', 0)).toEqual(['a', 'b']);
  });
});
