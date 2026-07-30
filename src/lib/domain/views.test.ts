import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Priority, type Tag, type Task } from './types';
import {
  groupByDate, groupByPriority, groupByTag, groupCompleted, openTasks, subSortGroups,
} from './views';

const now = new Date('2026-07-15T12:00:00');

let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'L1', name: `task-${n}`, notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});
const tag = (id: string, name: string): Tag =>
  ({ id, name, colorIndex: 0, createdAt: 0, updatedAt: 0, deleted: false });

describe('openTasks', () => {
  it('drops completed and deleted', () => {
    const open = task({ priority: 'low' });
    const done = task({ priority: 'low', completedAt: 5 });
    const gone = task({ priority: 'low', deleted: true });
    expect(openTasks([open, done, gone])).toEqual([open]);
  });
});

describe('groupByDate', () => {
  it('orders Overdue, dates ascending, No deadline; sub-sorts by effective priority', () => {
    const late = task({ priority: 'low', deadline: '2026-07-10' });
    const today = task({ priority: 'medium', deadline: '2026-07-15' });
    // Same future date, different manual priorities — derived is medium for both
    // (5 days out, 1h estimate), so manual max must sort above manual low.
    const soonHi = task({ priority: 'max', deadline: '2026-07-20' });
    const soonLo = task({ priority: 'low', deadline: '2026-07-20' });
    const never = task({ priority: 'high' });
    const groups = groupByDate([soonLo, never, today, late, soonHi], DEFAULT_SETTINGS, now);
    expect(groups.map((g) => g.key)).toEqual(['overdue', '2026-07-15', '2026-07-20', 'none']);
    expect(groups[2]!.tasks.map((t) => t.id)).toEqual([soonHi.id, soonLo.id]);
  });
});

describe('groupByPriority', () => {
  it('uses EFFECTIVE priority and sub-sorts by deadline', () => {
    const escalated = task({ priority: 'low', deadline: '2026-07-14' }); // overdue → max
    const manualMaxLater = task({ priority: 'max', deadline: '2026-07-20' });
    const manualMaxNoDl = task({ priority: 'max' });
    const medium = task({ priority: 'medium' });
    const groups = groupByPriority([medium, manualMaxNoDl, manualMaxLater, escalated], DEFAULT_SETTINGS, now);
    expect(groups.map((g) => g.key)).toEqual(['max', 'medium']);
    expect(groups[0]!.tasks.map((t) => t.id))
      .toEqual([escalated.id, manualMaxLater.id, manualMaxNoDl.id]); // deadline asc, none last
    expect(groups[0]!.label).toBe('Max');
  });
});

describe('groupByTag', () => {
  it('alphabetical sections, multi-tag duplication, Untagged last', () => {
    const zebra = tag('z', 'zebra');
    const alpha = tag('a', 'alpha');
    const both = task({ priority: 'high', tagIds: ['z', 'a'] });
    const onlyZ = task({ priority: 'low', tagIds: ['z'] });
    const none = task({ priority: 'low' });
    const groups = groupByTag([both, onlyZ, none], [zebra, alpha], DEFAULT_SETTINGS, now);
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'zebra', 'Untagged']);
    expect(groups[1]!.tasks.map((t) => t.id)).toEqual([both.id, onlyZ.id]); // priority desc
    expect(groups[0]!.tasks.map((t) => t.id)).toEqual([both.id]); // duplicated
  });

  it('omits empty tag sections', () => {
    const unused = tag('u', 'unused');
    const plain = task({ priority: 'low' });
    const groups = groupByTag([plain], [unused], DEFAULT_SETTINGS, now);
    expect(groups.map((g) => g.key)).toEqual(['untagged']);
  });
});

describe('sub-sorting within groups', () => {
  const zeta = task({ priority: 'low', name: 'zeta', createdAt: 100 });
  const alpha = task({ priority: 'low', name: 'Alpha', createdAt: 300 });
  const mid = task({ priority: 'low', name: 'mid', createdAt: 200 });
  const group = [{ key: 'g', label: 'g', tasks: [zeta, alpha, mid] }];

  it('smart leaves the grouper’s order alone', () => {
    expect(subSortGroups(group, 'smart')[0]!.tasks.map((t) => t.name)).toEqual(['zeta', 'Alpha', 'mid']);
  });

  it('alphabetical ignores case', () => {
    expect(subSortGroups(group, 'alpha')[0]!.tasks.map((t) => t.name)).toEqual(['Alpha', 'mid', 'zeta']);
  });

  it('alphabetical is numeric-aware: item 2 before item 10', () => {
    const g = [{ key: 'g', label: 'g', tasks: [
      task({ priority: 'low', name: 'item 10' }),
      task({ priority: 'low', name: 'item 2' }),
      task({ priority: 'low', name: 'item 1' }),
    ] }];
    expect(subSortGroups(g, 'alpha')[0]!.tasks.map((t) => t.name))
      .toEqual(['item 1', 'item 2', 'item 10']);
  });

  it('oldest and newest order by creation', () => {
    expect(subSortGroups(group, 'created')[0]!.tasks.map((t) => t.name)).toEqual(['zeta', 'mid', 'Alpha']);
    expect(subSortGroups(group, 'newest')[0]!.tasks.map((t) => t.name)).toEqual(['Alpha', 'mid', 'zeta']);
  });
});

describe('groupCompleted', () => {
  it('buckets by completion app-day (4am rule), newest first', () => {
    const lateNight = task({ priority: 'low', completedAt: new Date('2026-07-15T02:00:00').getTime() });
    const morning = task({ priority: 'low', completedAt: new Date('2026-07-15T09:00:00').getTime() });
    const older = task({ priority: 'low', completedAt: new Date('2026-07-01T12:00:00').getTime() });
    const groups = groupCompleted([older, lateNight, morning], 4);
    expect(groups.map((g) => g.key)).toEqual(['2026-07-15', '2026-07-14', '2026-07-01']);
    expect(groups[1]!.tasks.map((t) => t.id)).toEqual([lateNight.id]); // 2am → previous app-day
  });
});
