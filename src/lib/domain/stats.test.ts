import { describe, expect, it } from 'vitest';
import { type Priority, type Task } from './types';
import {
  formatDurationLong,
  burdenChange, burdenSeries, burdenShift, completionCounts, completionSeries,
  formatDuration, totalEstimateHours, winsList, estimateOutcome,
} from './stats';

const now = new Date('2026-07-15T12:00:00'); // a Wednesday

let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'L1', name: `task-${n}`, notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

const doneAt = (s: string) => task({ priority: 'low', completedAt: new Date(s).getTime() });

describe('completionCounts', () => {
  it('buckets by app-day, Sunday weeks, calendar month/year', () => {
    const tasks = [
      doneAt('2026-07-15T10:00:00'),  // today
      doneAt('2026-07-15T02:00:00'),  // 2am → belongs to the 14th, still this week
      doneAt('2026-07-13T09:00:00'),  // Monday — this week
      doneAt('2026-07-12T09:00:00'),  // Sunday — first day of THIS week now
      doneAt('2026-07-11T09:00:00'),  // Saturday — LAST week
      doneAt('2026-07-01T09:00:00'),  // this month
      doneAt('2026-01-02T09:00:00'),  // this year
      doneAt('2025-06-01T09:00:00'),  // lifetime only
    ];
    const c = completionCounts(tasks, now, 4);
    expect(c).toEqual({ today: 1, week: 4, month: 6, year: 7, lifetime: 8 });
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

  it('weekly buckets start on Sunday', () => {
    const tasks = [doneAt('2026-07-12T10:00:00'), doneAt('2026-07-11T10:00:00')];
    const s = completionSeries(tasks, 'week', 2, now, 4);
    expect(s[1]!.count).toBe(1); // this week opens Sun the 12th
    expect(s[0]!.count).toBe(1); // Sat the 11th closes LAST week
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

describe('formatDurationLong', () => {
  it('spells out every unit down to hours, minutes only when fractional', () => {
    expect(formatDurationLong(2 * 720 + 168 + 72 + 5)).toBe('2mo 1w 3d 5h');
    expect(formatDurationLong(26)).toBe('1d 2h');
    expect(formatDurationLong(2.5)).toBe('2h 30m');
    expect(formatDurationLong(0.5)).toBe('30m');
    expect(formatDurationLong(0)).toBe('0h');
  });

  it('skips zero units instead of printing them', () => {
    expect(formatDurationLong(720 + 3)).toBe('1mo 3h'); // no weeks, no days
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

describe('burdenShift', () => {
  const day = (s: string) => new Date(s).getTime();

  it('itemizes the delta: new-by-hand, new-by-rule, finished, removed', () => {
    const tasks = [
      // Standing since last week, untouched — in the pile both times, absent here.
      task({ priority: 'low', estimateHours: 4, createdAt: day('2026-07-10T09:00:00') }),
      // Added today by hand.
      task({ priority: 'low', estimateHours: 2, createdAt: day('2026-07-15T09:00:00') }),
      // Spawned today by a rule.
      task({ priority: 'low', estimateHours: 3, createdAt: day('2026-07-15T05:00:00'), recurrenceId: 'R1' }),
      // Standing yesterday, finished today.
      { ...task({ priority: 'low', estimateHours: 5, createdAt: day('2026-07-10T09:00:00') }),
        completedAt: day('2026-07-15T10:00:00') },
      // Standing yesterday, deleted today.
      { ...task({ priority: 'low', estimateHours: 7, createdAt: day('2026-07-10T09:00:00') }),
        deleted: true, updatedAt: day('2026-07-15T11:00:00') },
      // Born AND finished today: net zero, deliberately absent everywhere.
      { ...task({ priority: 'low', estimateHours: 9, createdAt: day('2026-07-15T08:00:00') }),
        completedAt: day('2026-07-15T09:30:00') },
    ];
    const s = burdenShift(tasks, 'day', now, 4);
    expect(s.addedByHand.map((e) => e.hours)).toEqual([2]);
    expect(s.addedByRules.map((e) => e.hours)).toEqual([3]);
    expect(s.completed.map((e) => e.hours)).toEqual([5]);
    expect(s.removed.map((e) => e.hours)).toEqual([7]);
  });

  it('the four buckets sum to the headline delta, exactly', () => {
    const tasks = [
      task({ priority: 'low', estimateHours: 4, createdAt: day('2026-07-01T09:00:00') }),
      task({ priority: 'low', createdAt: day('2026-07-15T09:00:00') }), // default 1h
      task({ priority: 'low', estimateHours: 2.5, createdAt: day('2026-07-15T06:00:00'), recurrenceId: 'R' }),
      { ...task({ priority: 'low', estimateHours: 5, createdAt: day('2026-07-02T09:00:00') }),
        completedAt: day('2026-07-15T10:00:00') },
      { ...task({ priority: 'low', estimateHours: 0.75, createdAt: day('2026-07-03T09:00:00') }),
        deleted: true, updatedAt: day('2026-07-14T09:00:00') },
    ];
    for (const window of ['day', 'week', 'month'] as const) {
      const s = burdenShift(tasks, window, now, 4);
      const sum = (rows: Array<{ hours: number }>) => rows.reduce((a, r) => a + r.hours, 0);
      const itemized = sum(s.addedByHand) + sum(s.addedByRules) - sum(s.completed) - sum(s.removed);
      expect(itemized, window).toBeCloseTo(burdenChange(tasks, window, now, 4), 10);
    }
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

describe('estimateOutcome', () => {
  const t = (estimateHours?: number, activeMs?: number) => ({ estimateHours, activeMs });

  it('exists only when BOTH an estimate and tracked time exist', () => {
    expect(estimateOutcome(t())).toBeNull();
    expect(estimateOutcome(t(2))).toBeNull();
    expect(estimateOutcome(t(undefined, 3_600_000))).toBeNull();
  });

  it('reports under, over, and right-on', () => {
    expect(estimateOutcome(t(2, 90 * 60_000))!.verdict).toBe('30m under the estimate');
    expect(estimateOutcome(t(1, 95 * 60_000))!.verdict).toBe('35m over the estimate');
    expect(estimateOutcome(t(1, 3_600_000 + 20_000))!.verdict).toBe('right on the estimate');
  });

  it('formats both sides for reading', () => {
    const o = estimateOutcome(t(2.5, 100 * 60_000))!;
    expect(o.estimate).toBe('2h 30m');
    expect(o.actual).toBe('1h 40m');
    expect(o.verdict).toBe('50m under the estimate');
  });
});
