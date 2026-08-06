import { describe, expect, it } from 'vitest';
import { nextScheduledSpawn, scheduleAfterCompletion, sweepSpawns } from './recurrence';
import { DEFAULT_SETTINGS, type RecurrenceTemplate, type Task } from './types';

const tpl = (over: Partial<RecurrenceTemplate>): RecurrenceTemplate => ({
  id: 'r1', listId: 'L1', name: 'water plants', notes: '', tagIds: [], priority: 'medium',
  mode: { kind: 'weekly', weekdays: [1] }, paused: false,
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

const at = (s: string) => new Date(s);

describe('scheduleAfterCompletion', () => {
  it('adds days as exact offset', () => {
    const t = tpl({ mode: { kind: 'afterCompletion', interval: 3, unit: 'days' } });
    expect(scheduleAfterCompletion(t, at('2026-07-10T15:00:00')))
      .toBe(at('2026-07-13T15:00:00').getTime());
  });

  it('weeks multiply days', () => {
    const t = tpl({ mode: { kind: 'afterCompletion', interval: 2, unit: 'weeks' } });
    expect(scheduleAfterCompletion(t, at('2026-07-10T15:00:00')))
      .toBe(at('2026-07-24T15:00:00').getTime());
  });

  it('months clamp to month length (Jan 31 + 1mo → Feb 28 in 2027)', () => {
    const t = tpl({ mode: { kind: 'afterCompletion', interval: 1, unit: 'months' } });
    expect(scheduleAfterCompletion(t, at('2027-01-31T09:00:00')))
      .toBe(at('2027-02-28T09:00:00').getTime());
  });

  it('returns null for scheduled modes', () => {
    expect(scheduleAfterCompletion(tpl({}), at('2026-07-10T15:00:00'))).toBeNull();
  });
});

describe('nextScheduledSpawn', () => {
  it('weekly: next matching weekday at rollover hour, strictly after', () => {
    expect(nextScheduledSpawn({ kind: 'weekly', weekdays: [1] }, at('2026-07-15T12:00:00'), 4))
      .toBe(at('2026-07-20T04:00:00').getTime()); // Wed → next Mon
    expect(nextScheduledSpawn({ kind: 'weekly', weekdays: [1] }, at('2026-07-20T04:00:00'), 4))
      .toBe(at('2026-07-27T04:00:00').getTime()); // exactly at spawn moment → next week
  });

  it('weekly: multiple weekdays picks the soonest', () => {
    expect(nextScheduledSpawn({ kind: 'weekly', weekdays: [1, 5] }, at('2026-07-15T12:00:00'), 4))
      .toBe(at('2026-07-17T04:00:00').getTime()); // Wed → Fri before Mon
  });

  it('monthly: clamps day 31 in short months', () => {
    expect(nextScheduledSpawn({ kind: 'monthly', dayOfMonth: 31 }, at('2026-02-05T12:00:00'), 4))
      .toBe(at('2026-02-28T04:00:00').getTime());
    expect(nextScheduledSpawn({ kind: 'monthly', dayOfMonth: 31 }, at('2026-02-28T05:00:00'), 4))
      .toBe(at('2026-03-31T04:00:00').getTime());
  });

  it('returns null for afterCompletion', () => {
    expect(nextScheduledSpawn({ kind: 'afterCompletion', interval: 1, unit: 'days' }, at('2026-07-15T12:00:00'), 4)).toBeNull();
  });

  // 2026-07-15 is a Wednesday; its Sunday-first week starts 2026-07-12.
  it('every 2 weeks: skips the off week, counted from the anchor week', () => {
    const mode = {
      kind: 'weekly' as const, weekdays: [1], everyWeeks: 2,
      anchorMs: at('2026-07-15T12:00:00').getTime(),
    };
    // Anchor week (Jul 12–18) is ON, so its Monday is gone already; the next
    // ON Monday is Jul 27 — NOT Jul 20, which sits in the off week.
    expect(nextScheduledSpawn(mode, at('2026-07-15T12:00:00'), 4))
      .toBe(at('2026-07-27T04:00:00').getTime());
    // From inside the off week it still lands on the same on-Monday.
    expect(nextScheduledSpawn(mode, at('2026-07-21T09:00:00'), 4))
      .toBe(at('2026-07-27T04:00:00').getTime());
    // And exactly at that spawn moment, the NEXT one is a fortnight on.
    expect(nextScheduledSpawn(mode, at('2026-07-27T04:00:00'), 4))
      .toBe(at('2026-08-10T04:00:00').getTime());
  });

  it('every 2 weeks with several weekdays keeps them inside the on week', () => {
    const mode = {
      kind: 'weekly' as const, weekdays: [1, 4], everyWeeks: 2,
      anchorMs: at('2026-07-15T12:00:00').getTime(),
    };
    // Thu Jul 16 is still ahead inside the anchor (on) week.
    expect(nextScheduledSpawn(mode, at('2026-07-15T12:00:00'), 4))
      .toBe(at('2026-07-16T04:00:00').getTime());
    // After it: the off week is silent, Monday of the next on week wins.
    expect(nextScheduledSpawn(mode, at('2026-07-16T04:00:00'), 4))
      .toBe(at('2026-07-27T04:00:00').getTime());
  });

  it('every-N without an anchor degrades to plain weekly, never drifts', () => {
    expect(nextScheduledSpawn({ kind: 'weekly', weekdays: [1], everyWeeks: 2 }, at('2026-07-15T12:00:00'), 4))
      .toBe(at('2026-07-20T04:00:00').getTime());
  });

  it('an anchor in the future still yields a correct on-week (negative modulo)', () => {
    const mode = {
      kind: 'weekly' as const, weekdays: [1], everyWeeks: 2,
      anchorMs: at('2026-08-12T12:00:00').getTime(), // four weeks after Jul 15's week
    };
    // Aug 12's week and Jul 15's week are exactly 4 apart — Jul 20's week is
    // 3 behind (odd) → off; Jul 27's week is 2 behind (even) → on.
    expect(nextScheduledSpawn(mode, at('2026-07-15T12:00:00'), 4))
      .toBe(at('2026-07-27T04:00:00').getTime());
  });

  it('monthly with several days picks whichever comes soonest', () => {
    const mode = { kind: 'monthly' as const, dayOfMonth: 15, days: [15, 'last'] as Array<number | 'last'> };
    expect(nextScheduledSpawn(mode, at('2026-07-10T12:00:00'), 4))
      .toBe(at('2026-07-15T04:00:00').getTime());
    expect(nextScheduledSpawn(mode, at('2026-07-15T04:00:00'), 4))
      .toBe(at('2026-07-31T04:00:00').getTime()); // "last" of July
    expect(nextScheduledSpawn(mode, at('2026-07-31T04:00:00'), 4))
      .toBe(at('2026-08-15T04:00:00').getTime());
  });

  it('"last" means the real month end, February included', () => {
    const mode = { kind: 'monthly' as const, dayOfMonth: 31, days: ['last'] as Array<number | 'last'> };
    expect(nextScheduledSpawn(mode, at('2026-02-01T12:00:00'), 4))
      .toBe(at('2026-02-28T04:00:00').getTime());
  });

  it('days supersedes dayOfMonth when both are present', () => {
    const mode = { kind: 'monthly' as const, dayOfMonth: 1, days: [20] as Array<number | 'last'> };
    expect(nextScheduledSpawn(mode, at('2026-07-02T12:00:00'), 4))
      .toBe(at('2026-07-20T04:00:00').getTime()); // NOT the 1st of August
  });

  it("an anchor in the rollover window belongs to the APP day's week, not the calendar's", () => {
    // Saved at Sunday 00:30 with rollover 4: the user's app-day is still
    // Saturday, so Saturday's week (Aug 2–8) is the ON week — calendar
    // bucketing would flip the whole fortnight (review catch, 2026-08-06).
    const lateNight = {
      kind: 'weekly' as const, weekdays: [6], everyWeeks: 2,
      anchorMs: at('2026-08-09T00:30:00').getTime(), // Sun 00:30 ≡ app-day Sat Aug 8
    };
    const beforeMidnight = {
      ...lateNight, anchorMs: at('2026-08-08T23:50:00').getTime(), // Sat 23:50, same app-day
    };
    const nextA = nextScheduledSpawn(lateNight, at('2026-08-09T05:00:00'), 4);
    const nextB = nextScheduledSpawn(beforeMidnight, at('2026-08-09T05:00:00'), 4);
    // Forty minutes apart within ONE app-day must produce the same cadence.
    expect(nextA).toBe(nextB);
    expect(nextA).toBe(at('2026-08-22T04:00:00').getTime()); // Aug 8's week ON → next ON Sat = Aug 22
  });
});

describe('sweepSpawns', () => {
  const now = at('2026-07-20T05:00:00'); // Monday, past 4am

  const openInstance = (rid: string): Task => ({
    id: 'x1', listId: 'L1', name: 'water plants', notes: '', tagIds: [], priority: 'medium',
    inProgress: false, recurrenceId: rid, createdAt: 0, updatedAt: 0, deleted: false,
  });

  it('spawns a due scheduled template and advances nextSpawnAt', () => {
    const t = tpl({ nextSpawnAt: at('2026-07-20T04:00:00').getTime(), deadlineOffsetDays: 2, estimateHours: 1 });
    const res = sweepSpawns([t], [], now, DEFAULT_SETTINGS);
    expect(res.drafts).toHaveLength(1);
    const d = res.drafts[0]!;
    expect(d.recurrenceId).toBe('r1');
    expect(d.priority).toBe('medium');
    expect(d.deadline).toBe('2026-07-22'); // spawn app-day + offset 2
    expect(d.inProgress).toBe(false);
    expect(res.updates[0]!.nextSpawnAt).toBe(at('2026-07-27T04:00:00').getTime());
  });

  it('offset 0 means due the day it spawns — 0 is a value, not "unset"', () => {
    const t = tpl({ nextSpawnAt: at('2026-07-20T04:00:00').getTime(), deadlineOffsetDays: 0 });
    const res = sweepSpawns([t], [], now, DEFAULT_SETTINGS);
    expect(res.drafts[0]!.deadline).toBe('2026-07-20');
  });

  it('no offset means no deadline on the spawn', () => {
    const t = tpl({ nextSpawnAt: at('2026-07-20T04:00:00').getTime() });
    const res = sweepSpawns([t], [], now, DEFAULT_SETTINGS);
    expect(res.drafts[0]!.deadline).toBeUndefined();
  });

  it('skip-if-open: no draft while an instance is open, but schedule still advances', () => {
    const t = tpl({ nextSpawnAt: at('2026-07-20T04:00:00').getTime() });
    const res = sweepSpawns([t], [openInstance('r1')], now, DEFAULT_SETTINGS);
    expect(res.drafts).toHaveLength(0);
    expect(res.updates[0]!.nextSpawnAt).toBe(at('2026-07-27T04:00:00').getTime());
  });

  it('afterCompletion spawns then clears nextSpawnAt', () => {
    const t = tpl({ mode: { kind: 'afterCompletion', interval: 3, unit: 'days' }, nextSpawnAt: now.getTime() - 1000 });
    const res = sweepSpawns([t], [], now, DEFAULT_SETTINGS);
    expect(res.drafts).toHaveLength(1);
    expect(res.updates[0]!.nextSpawnAt).toBeUndefined();
  });

  it('ignores paused, deleted, not-yet-due, and unscheduled templates', () => {
    const due = at('2026-07-20T04:00:00').getTime();
    const list = [
      tpl({ id: 'p', paused: true, nextSpawnAt: due }),
      tpl({ id: 'd', deleted: true, nextSpawnAt: due }),
      tpl({ id: 'f', nextSpawnAt: now.getTime() + 60_000 }),
      tpl({ id: 'u', nextSpawnAt: undefined }),
    ];
    const res = sweepSpawns(list, [], now, DEFAULT_SETTINGS);
    expect(res.drafts).toHaveLength(0);
    expect(res.updates).toHaveLength(0);
  });
});
