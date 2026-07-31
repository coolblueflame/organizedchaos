import { describe, expect, it } from 'vitest';
import type { Priority, Task } from './types';
import { weekReview, weekWinsList } from './weekReview';

// Thursday 2026-07-30 → app-week Mon 07-27 .. Sun 08-02; last week 07-20..26.
const NOW = new Date('2026-07-30T15:00:00');
const at = (iso: string) => new Date(iso).getTime();

let n = 0;
const done = (over: Partial<Task> & { completedAt: number }): Task => ({
  id: `t${n++}`, listId: 'L1', name: `win-${n}`, notes: '', tagIds: [],
  priority: 'medium' as Priority, inProgress: false,
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

describe('weekReview', () => {
  it('buckets Monday-first, splits this week from last, finds the best day', () => {
    const r = weekReview([
      done({ completedAt: at('2026-07-27T10:00:00') }), // Mon
      done({ completedAt: at('2026-07-29T10:00:00') }), // Wed
      done({ completedAt: at('2026-07-29T18:00:00') }), // Wed again
      done({ completedAt: at('2026-07-22T10:00:00') }), // LAST week
      done({ completedAt: at('2026-07-20T10:00:00') }), // LAST week
    ], NOW, 4);
    expect(r.completions).toBe(3);
    expect(r.prevCompletions).toBe(2);
    expect(r.daily).toEqual([1, 0, 2, 0, 0, 0, 0]);
    expect(r.bestDay).toEqual({ key: '2026-07-29', count: 2 });
  });

  it('respects the 4am rollover: a 2am finish belongs to the day before', () => {
    // 02:00 on Monday the 27th is still app-Sunday the 26th → LAST week.
    const r = weekReview([done({ completedAt: at('2026-07-27T02:00:00') })], NOW, 4);
    expect(r.completions).toBe(0);
    expect(r.prevCompletions).toBe(1);
  });

  it('sums tracked time and scores estimates only where both sides exist', () => {
    const r = weekReview([
      done({ completedAt: at('2026-07-28T10:00:00'), estimateHours: 1, activeMs: 3_600_000 }),
      done({ completedAt: at('2026-07-28T11:00:00'), estimateHours: 1, activeMs: 2 * 3_600_000 }),
      done({ completedAt: at('2026-07-28T12:00:00'), activeMs: 30 * 60_000 }), // untracked estimate
      done({ completedAt: at('2026-07-28T13:00:00') }),                        // nothing tracked
    ], NOW, 4);
    expect(r.trackedMs).toBe(3_600_000 + 2 * 3_600_000 + 30 * 60_000);
    expect(r.estimates).toEqual({ on: 1, over: 1, under: 0 });
  });

  it('top wins lead with priority, then recency, capped at five', () => {
    const max = done({ completedAt: at('2026-07-27T10:00:00'), priority: 'max', name: 'the big one' });
    const rest = [1, 2, 3, 4, 5].map((h) =>
      done({ completedAt: at(`2026-07-28T1${h}:00:00`), name: `small ${h}` }));
    const r = weekReview([...rest, max], NOW, 4);
    expect(r.topWins).toHaveLength(5);
    expect(r.topWins[0]!.name).toBe('the big one');
    expect(r.topWins[1]!.name).toBe('small 5'); // most recent of the mediums
  });

  it('an empty week reports honest zeroes', () => {
    const r = weekReview([], NOW, 4);
    expect(r.completions).toBe(0);
    expect(r.bestDay).toBeNull();
    expect(r.estimates).toBeNull();
  });
});

describe('weekWinsList', () => {
  it('bullets the week oldest-first and ignores other weeks', () => {
    const list = weekWinsList([
      done({ completedAt: at('2026-07-29T10:00:00'), name: 'second' }),
      done({ completedAt: at('2026-07-27T10:00:00'), name: 'first' }),
      done({ completedAt: at('2026-07-20T10:00:00'), name: 'old news' }),
    ], NOW, 4);
    expect(list).toBe('- first\n- second');
  });
});
