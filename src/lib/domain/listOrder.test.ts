import { describe, expect, it } from 'vitest';
import { moveAcross, moveWithin, pickerListGroups, reorderPatches, sameGrouping, sortLists } from './listOrder';
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

describe('moveAcross', () => {
  const groups = () => new Map([
    ['', ['inbox']],
    ['Work', ['w1', 'w2', 'w3']],
    ['Home', ['h1', 'h2']],
  ]);

  it('moves a list into another group at the requested position', () => {
    const out = moveAcross(groups(), 'w2', 'Home', 1);
    expect(out.get('Work')).toEqual(['w1', 'w3']);
    expect(out.get('Home')).toEqual(['h1', 'w2', 'h2']);
  });

  it('still reorders within a group', () => {
    const out = moveAcross(groups(), 'w3', 'Work', 0);
    expect(out.get('Work')).toEqual(['w3', 'w1', 'w2']);
  });

  it('can empty a group out entirely', () => {
    const out = moveAcross(groups(), 'inbox', 'Work', 3);
    expect(out.get('')).toEqual([]);
    expect(out.get('Work')).toEqual(['w1', 'w2', 'w3', 'inbox']);
  });

  it('clamps an index past the end rather than losing the row', () => {
    const out = moveAcross(groups(), 'h1', 'Work', 99);
    expect(out.get('Work')).toEqual(['w1', 'w2', 'w3', 'h1']);
  });

  it('leaves the input alone', () => {
    const before = groups();
    moveAcross(before, 'w1', 'Home', 0);
    expect(before.get('Work')).toEqual(['w1', 'w2', 'w3']);
  });

  it('sameGrouping tells an idle drag from a real one', () => {
    expect(sameGrouping(groups(), groups())).toBe(true);
    expect(sameGrouping(groups(), moveAcross(groups(), 'w1', 'Home', 0))).toBe(false);
  });
});

describe('pickerListGroups', () => {
  const themed = (id: string, over: Partial<List>): List => ({ ...list(id), ...over });

  it('reads like the home screen: ungrouped first, groups alphabetical, drag order within', () => {
    const out = pickerListGroups([
      themed('z1', { areaGroup: 'Zoo' }),
      themed('loose', {}),
      themed('a2', { areaGroup: 'Art', order: 1 }),
      themed('a1', { areaGroup: 'Art', order: 0 }),
    ]);
    expect(out.map((g) => g.group)).toEqual(['', 'Art', 'Zoo']);
    expect(out[1]!.lists.map((l) => l.id)).toEqual(['a1', 'a2']);
  });

  it('offers neither archived lists nor dice-made vessels nor tombstones', () => {
    const out = pickerListGroups([
      themed('live', {}),
      themed('shelved', { archived: true }),
      themed('vessel', { generated: true }),
      themed('gone', { deleted: true }),
    ]);
    expect(out.flatMap((g) => g.lists.map((l) => l.id))).toEqual(['live']);
  });

  it('a group whose lists are all archived vanishes entirely', () => {
    const out = pickerListGroups([
      themed('a', { areaGroup: 'Dust', archived: true }),
      themed('b', {}),
    ]);
    expect(out.map((g) => g.group)).toEqual(['']);
  });
});
