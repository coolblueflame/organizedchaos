import { describe, expect, it } from 'vitest';
import { groupRecurring } from './recurringOrder';
import type { List, RecurrenceTemplate } from './types';

let n = 0;
const tpl = (over: Partial<RecurrenceTemplate> = {}): RecurrenceTemplate => ({
  id: `r${n++}`, listId: 'L1', name: `rule ${n}`, notes: '', tagIds: [],
  priority: 'medium', mode: { kind: 'weekly', weekdays: [1] }, paused: false,
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});
const list = (over: Partial<List> & { id: string; title: string }): List => ({
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
} as List);

const LISTS = [
  list({ id: 'L1', title: 'Chores' }),
  list({ id: 'L2', title: 'Work', areaGroup: 'Job' }),
];

describe('groupRecurring', () => {
  it('by list: home order, headers, alphabetical inside', () => {
    const a = tpl({ listId: 'L2', name: 'zebra' });
    const b = tpl({ listId: 'L1', name: 'item 10' });
    const c = tpl({ listId: 'L1', name: 'item 2' });
    const got = groupRecurring([a, b, c], 'list', LISTS);
    // Headers are LIST titles — "group them by what todo list they're on";
    // the area group only decides where each list falls in the order.
    expect(got.map((g) => g.group)).toEqual(['Chores', 'Work']);
    expect(got[0]!.templates.map((t) => t.name), 'numeric-aware, not "10" before "2"')
      .toEqual(['item 2', 'item 10']);
  });

  it('by list: a rule whose list is gone still has somewhere to be', () => {
    // Otherwise it disappears from the only screen that can edit or delete it.
    const orphan = tpl({ listId: 'deleted-list', name: 'homeless' });
    const got = groupRecurring([orphan], 'list', LISTS);
    expect(got.map((g) => g.group)).toEqual(['elsewhere']);
  });

  it('the flat orders answer as one nameless group', () => {
    const got = groupRecurring([tpl(), tpl()], 'alpha', LISTS);
    expect(got).toHaveLength(1);
    expect(got[0]!.group).toBe('');
  });

  it('next up: soonest first, unarmed rules last', () => {
    const soon = tpl({ name: 'soon', nextSpawnAt: 100 });
    const later = tpl({ name: 'later', nextSpawnAt: 900 });
    const resting = tpl({ name: 'resting' }); // paused or waiting on its copy
    expect(groupRecurring([resting, later, soon], 'next', LISTS)[0]!.templates.map((t) => t.name))
      .toEqual(['soon', 'later', 'resting']);
  });

  it('most kept: by completions, and never-kept counts as none', () => {
    const faithful = tpl({ name: 'faithful', completedInstances: 40 });
    const some = tpl({ name: 'some', completedInstances: 3 });
    const fresh = tpl({ name: 'fresh' });
    expect(groupRecurring([fresh, some, faithful], 'kept', LISTS)[0]!.templates.map((t) => t.name))
      .toEqual(['faithful', 'some', 'fresh']);
  });

  it('never drops a rule, whatever the order', () => {
    const all = [tpl({ listId: 'L1' }), tpl({ listId: 'L2' }), tpl({ listId: 'nope' })];
    for (const sort of ['list', 'alpha', 'next', 'kept'] as const) {
      const flat = groupRecurring(all, sort, LISTS).flatMap((g) => g.templates);
      expect(flat, `sort ${sort}`).toHaveLength(3);
    }
  });
});
