/**
 * Manual ordering of lists on the home screen (2026-07-28 request).
 *
 * Lists that have never been dragged carry no `order` at all, and must keep
 * the sequence they already had — a user who reorders one group should not
 * find another silently rearranged. So ordered lists sort by their number and
 * unordered ones hold their existing relative positions.
 */
import type { List } from './types';

/**
 * Sort a group for display. Stable by construction: entries without an order
 * fall back to their incoming index, so an untouched group is unchanged.
 */
export function sortLists(lists: List[]): List[] {
  return lists
    .map((list, index) => ({ list, index }))
    .sort((a, b) => {
      const ao = a.list.order;
      const bo = b.list.order;
      if (ao === undefined && bo === undefined) return a.index - b.index;
      // An explicitly ordered list outranks an untouched one, so dragging
      // something to the top actually puts it there.
      if (ao === undefined) return 1;
      if (bo === undefined) return -1;
      return ao === bo ? a.index - b.index : ao - bo;
    })
    .map((entry) => entry.list);
}

/**
 * The patches needed to store `orderedIds` as the new sequence.
 *
 * Every member of the group gets an explicit number, not just the one that
 * moved: a half-ordered group is exactly where "no order" and "order 0" start
 * disagreeing about who comes first. Only genuinely changed rows are returned,
 * so an idle drag writes nothing and syncs nothing.
 */
export function reorderPatches(orderedIds: string[], lists: List[]): Array<{ id: string; order: number }> {
  const byId = new Map(lists.map((l) => [l.id, l]));
  const patches: Array<{ id: string; order: number }> = [];
  orderedIds.forEach((id, index) => {
    const list = byId.get(id);
    if (list && list.order !== index) patches.push({ id, order: index });
  });
  return patches;
}

/** Move one id to a new index within its group, returning the new id sequence. */
export function moveWithin(ids: string[], id: string, toIndex: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const out = [...ids];
  out.splice(from, 1);
  out.splice(Math.max(0, Math.min(toIndex, out.length)), 0, id);
  return out;
}
