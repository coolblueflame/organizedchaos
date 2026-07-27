import { describe, expect, it } from 'vitest';
import { type Priority, type Task } from './types';
import {
  burdenSeries, completionCounts, completionSeries, formatDuration, totalEstimateHours,
  winsList,
} from './stats';

const now = new Date('2026-07-15T12:00:00'); // a Wednesday

let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'L1', name: `task-${n}`, notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

const doneAt = (s: string) => task({ priority: 'low', completedAt: new Date(s).getTime() });

describe('completionCounts', () => {
  it('buckets by app-day, Monday weeks, calendar month/year', () => {
    const tasks = [
      doneAt('2026-07-15T10:00:00'),  // today
      doneAt('2026-07-15T02:00:00'),  // 2am → belongs to the 14th, still this week
      doneAt('2026-07-13T09:00:00'),  // Monday — this week
      doneAt('2026-07-12T09:00:00'),  // Sunday — LAST week
      doneAt('2026-07-01T09:00:00'),  // this month
      doneAt('2026-01-02T09:00:00'),  // this year
      doneAt('2025-06-01T09:00:00'),  // lifetime only
    ];
    const c = completionCounts(tasks, now, 4);
    expect(c).toEqual({ today: 1, week: 3, month: 5, year: 6, lifetime: 7 });
  });

  it('imported history stays out of the scoreboard but still feeds the graphs', () => {
    const mine = doneAt('2026-07-15T10:00:00');
    const imported = { ...doneAt('2026-07-15T09:00:00'), importedHistory: true };
    const counts = completionCounts([mine, imported], now, 4);
    expect(counts).toMatchObject({ today: 1, lifetime: 1 });

    // …but the over-time series still shows the full history
    const series = completionSeries([mine, imported], 'day', 1, now, 4);
    expect(series[0]!.count).toBe(2);
  });

  it('ignores open and deleted tasks', () => {
    const open = task({ priority: 'low' });
    const ghost = { ...doneAt('2026-07-15T10:00:00'), deleted: true };
    expect(completionCounts([open, ghost], now, 4).lifetime).toBe(0);
  });
});

describe('completionSeries', () => {
  it('zero-fills daily buckets oldest→newest', () => {
    const tasks = [doneAt('2026-07-15T10:00:00'), doneAt('2026-07-13T10:00:00'), doneAt('2026-07-13T11:00:00')];
    const s = completionSeries(tasks, 'day', 4, now, 4);
    expect(s.map((p) => p.count)).toEqual([0, 2, 0, 1]); // 12th, 13th ×2, 14th, 15th ×1
    expect(s[3]!.key).toBe('2026-07-15');
  });

  it('weekly buckets start on Monday', () => {
    const tasks = [doneAt('2026-07-13T10:00:00'), doneAt('2026-07-12T10:00:00')];
    const s = completionSeries(tasks, 'week', 2, now, 4);
    expect(s[1]!.count).toBe(1); // this week: Mon 13th only
    expect(s[0]!.count).toBe(1); // last week: Sun 12th
  });
});

describe('estimates', () => {
  it('sums open estimates with 1h default, skipping done/deleted', () => {
    const tasks = [
      task({ priority: 'low', estimateHours: 2.5 }),
      task({ priority: 'low' }),                                     // → 1
      task({ priority: 'low', estimateHours: 4, completedAt: 5 }),   // done
      { ...task({ priority: 'low', estimateHours: 9 }), deleted: true },
    ];
    expect(totalEstimateHours(tasks)).toBe(3.5);
  });

  it('formats literal durations with two significant units', () => {
    expect(formatDuration(0)).toBe('0h');
    expect(formatDuration(5)).toBe('5h');
    expect(formatDuration(26)).toBe('1d 2h');
    expect(formatDuration(24 * 7 + 24 * 2)).toBe('1w 2d');
    expect(formatDuration(24 * 30 + 24 * 7)).toBe('1mo 1w');
    expect(formatDuration(24 * 365 + 24 * 60)).toBe('1y 2mo');
  });
});

describe('burdenSeries', () => {
  it('reconstructs backlog hours per day from create/complete/delete times', () => {
    const t1 = task({ priority: 'low', estimateHours: 2, createdAt: new Date('2026-07-10T09:00:00').getTime() });
    const t2 = {
      ...task({ priority: 'low', createdAt: new Date('2026-07-11T09:00:00').getTime() }),
      completedAt: new Date('2026-07-13T09:00:00').getTime(),
    };
    const t3 = {
      ...task({ priority: 'low', estimateHours: 5, createdAt: new Date('2026-07-10T09:00:00').getTime() }),
      deleted: true, updatedAt: new Date('2026-07-12T09:00:00').getTime(),
    };
    const s = burdenSeries([t1, t2, t3], 6, now, 4);
    const byKey = Object.fromEntries(s.map((p) => [p.key, p.hours]));
    expect(byKey['2026-07-10']).toBe(7);  // t1(2) + t3(5)
    expect(byKey['2026-07-11']).toBe(8);  // + t2(1)
    expect(byKey['2026-07-12']).toBe(3);  // t3 deleted that day → gone
    expect(byKey['2026-07-13']).toBe(2);  // t2 completed → gone
    expect(byKey['2026-07-15']).toBe(2);  // just t1 remains
  });
});

describe('shareable wins list', () => {
  const day = (iso: string) => new Date(iso).getTime();

  it('lists today\'s completions oldest first, dash-bulleted', () => {
    const now = new Date('2026-07-28T15:00:00');
    const tasks = [
      wins({ id: 'b', name: 'Book dentist', completedAt: day('2026-07-28T11:00:00') }),
      wins({ id: 'a', name: 'Mow the lawn', completedAt: day('2026-07-28T09:00:00') }),
    ];
    expect(winsList(tasks, now, 4)).toBe('- Mow the lawn\n- Book dentist');
  });

  it('respects the 4am app-day, not midnight', () => {
    const now = new Date('2026-07-28T02:00:00'); // still "the 27th" until 4am
    const tasks = [
      wins({ id: 'late', name: 'Late night win', completedAt: day('2026-07-28T01:30:00') }),
      wins({ id: 'prev', name: 'Yesterday morning', completedAt: day('2026-07-27T10:00:00') }),
      wins({ id: 'older', name: 'Two days ago', completedAt: day('2026-07-26T10:00:00') }),
    ];
    expect(winsList(tasks, now, 4)).toBe('- Yesterday morning\n- Late night win');
  });

  it('leaves out imported history, deleted tasks and anything unfinished', () => {
    const now = new Date('2026-07-28T15:00:00');
    const done = day('2026-07-28T10:00:00');
    const tasks = [
      wins({ id: 'real', name: 'Real win', completedAt: done }),
      wins({ id: 'imported', name: 'From Things', completedAt: done, importedHistory: true }),
      wins({ id: 'gone', name: 'Deleted', completedAt: done, deleted: true }),
      wins({ id: 'open', name: 'Still open' }),
    ];
    expect(winsList(tasks, now, 4)).toBe('- Real win');
  });

  it('is empty when nothing has been finished today', () => {
    expect(winsList([wins({ id: 'x', name: 'open' })], new Date('2026-07-28T15:00:00'), 4)).toBe('');
  });

  it('still emits a line for a task that was never named', () => {
    const now = new Date('2026-07-28T15:00:00');
    const tasks = [wins({ id: 'u', name: '  ', completedAt: day('2026-07-28T10:00:00') })];
    expect(winsList(tasks, now, 4)).toBe('- untitled');
  });
});

/** Local fixture for the wins tests: priority is irrelevant to this list. */
function wins(over: Partial<Task>): Task {
  return task({ priority: 'medium', ...over });
}
