import { describe, expect, it } from 'vitest';
import type { List, Priority, Task } from './types';
import { daysUntilWrapped, wrappedIsOpen, yearWrapped } from './wrapped';

const NOW = new Date('2026-12-15T12:00:00');
const at = (iso: string) => new Date(iso).getTime();

let n = 0;
const done = (over: Partial<Task> & { completedAt: number }): Task => ({
  id: `t${n++}`, listId: 'L1', name: `win-${n}`, notes: '', tagIds: [],
  priority: 'medium' as Priority, inProgress: false,
  createdAt: at('2026-01-05T10:00:00'), updatedAt: 0, deleted: false, ...over,
});
const list = (id: string, title: string): List => ({
  id, title, sortMode: 'priority', createdAt: 0, updatedAt: 0, deleted: false,
});

describe('yearWrapped', () => {
  it('buckets the app-year by month and finds the busiest day and month', () => {
    const r = yearWrapped([
      done({ completedAt: at('2026-03-10T10:00:00') }),
      done({ completedAt: at('2026-03-10T18:00:00') }),
      done({ completedAt: at('2026-03-12T10:00:00') }),
      done({ completedAt: at('2026-07-01T10:00:00') }),
      done({ completedAt: at('2025-12-30T10:00:00') }), // last year — out
    ], [], NOW, 4);
    expect(r.year).toBe(2026);
    expect(r.completions).toBe(4);
    expect(r.byMonth[2]).toBe(3); // March
    expect(r.byMonth[6]).toBe(1); // July
    expect(r.busiestDay).toEqual({ key: '2026-03-10', count: 2 });
    expect(r.busiestMonth).toEqual({ month: 2, count: 3 });
    expect(r.activeDays).toBe(3);
  });

  it('respects the rollover at the year boundary: 2am Jan 1 is still last year', () => {
    const r = yearWrapped(
      [done({ completedAt: at('2026-01-01T02:00:00'), createdAt: 0 })], [], NOW, 4);
    expect(r.completions).toBe(0);
  });

  it('counts creations, tracked time, and ranks the top lists by completions', () => {
    const lists = [list('L1', 'Work'), list('L2', 'Home')];
    const r = yearWrapped([
      done({ completedAt: at('2026-02-01T10:00:00'), listId: 'L1', activeMs: 3_600_000 }),
      done({ completedAt: at('2026-02-02T10:00:00'), listId: 'L2' }),
      done({ completedAt: at('2026-02-03T10:00:00'), listId: 'L2', activeMs: 1_800_000 }),
    ], lists, NOW, 4);
    expect(r.created).toBe(3); // all created 2026-01-05
    expect(r.trackedMs).toBe(5_400_000);
    expect(r.topLists).toEqual([
      { title: 'Home', count: 2 },
      { title: 'Work', count: 1 },
    ]);
  });

  it('crowns the longest haul: completed this year, created longest ago', () => {
    const r = yearWrapped([
      done({ completedAt: at('2026-06-01T10:00:00'), createdAt: at('2024-06-01T10:00:00'), name: 'the ancient one' }),
      done({ completedAt: at('2026-06-02T10:00:00'), createdAt: at('2026-05-30T10:00:00') }),
    ], [], NOW, 4);
    expect(r.longestHaul!.task.name).toBe('the ancient one');
    expect(r.longestHaul!.waitDays).toBe(730);
  });

  it('an empty year reports honest zeroes', () => {
    const r = yearWrapped([], [], NOW, 4);
    expect(r.completions).toBe(0);
    expect(r.busiestDay).toBeNull();
    expect(r.busiestMonth).toBeNull();
    expect(r.longestHaul).toBeNull();
    expect(r.topLists).toEqual([]);
  });
});

describe('the reveal gate', () => {
  it('opens for December app-days and no sooner', () => {
    expect(wrappedIsOpen(new Date('2026-11-30T12:00:00'), 4)).toBe(false);
    expect(wrappedIsOpen(new Date('2026-12-01T12:00:00'), 4)).toBe(true);
    // 2am Dec 1 is app-day Nov 30 — the door opens at 4am, like every day here.
    expect(wrappedIsOpen(new Date('2026-12-01T02:00:00'), 4)).toBe(false);
    expect(wrappedIsOpen(NOW, 4)).toBe(true);
  });

  it('counts down by app-days and reads 0 once open', () => {
    expect(daysUntilWrapped(new Date('2026-11-29T12:00:00'), 4)).toBe(2);
    expect(daysUntilWrapped(new Date('2026-12-15T12:00:00'), 4)).toBe(0);
  });
});
