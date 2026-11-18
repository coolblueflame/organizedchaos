import { describe, expect, it } from 'vitest';
import { onlySkippedToday, skipKind, skippedToday } from './skip';
import type { RecurrenceMode, RecurrenceTemplate, Task } from './types';

const now = new Date('2026-11-18T10:00:00'); // app day 2026-11-18 at rollover 4
const task = (over: Partial<Task>): Task => ({
  id: 't1', listId: 'L1', name: 'x', notes: '', priority: 'medium', tagIds: [], inProgress: false,
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});
const tpl = (mode: RecurrenceMode, over: Partial<RecurrenceTemplate> = {}): RecurrenceTemplate => ({
  id: 'r1', listId: 'L1', name: 'x', notes: '', tagIds: [], priority: 'medium', mode, paused: false,
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});
const allDay = { days: [0, 1, 2, 3, 4, 5, 6], from: '08:00', to: '20:00' };
const evening = { days: [0, 1, 2, 3, 4, 5, 6], from: '20:00', to: '22:00' };

describe('skipKind', () => {
  it('a weekly, monthly or after-completion copy skips as a repeat', () => {
    for (const mode of [
      { kind: 'weekly', weekdays: [2] },
      { kind: 'monthly', dayOfMonth: 1 },
      { kind: 'afterCompletion', interval: 5, unit: 'days' },
    ] as RecurrenceMode[]) {
      expect(skipKind(task({ recurrenceId: 'r1' }), [tpl(mode)], now, 4)).toBe('repeat');
    }
  });

  it('a peppered copy, a plain task, a done copy and an orphaned copy cannot skip', () => {
    const pepper = tpl({ kind: 'chance', baseChance: 20, perRollBoost: 1 });
    expect(skipKind(task({ recurrenceId: 'r1' }), [pepper], now, 4)).toBeNull();
    expect(skipKind(task({}), [], now, 4)).toBeNull();
    const weekly = tpl({ kind: 'weekly', weekdays: [2] });
    expect(skipKind(task({ recurrenceId: 'r1', completedAt: 1 }), [weekly], now, 4)).toBeNull();
    expect(skipKind(task({ recurrenceId: 'r1' }), [{ ...weekly, deleted: true }], now, 4)).toBeNull();
  });

  it('a ritual skips while something is still owed today', () => {
    expect(skipKind(task({ rituals: [allDay] }), [], now, 4)).toBe('ritual');
    expect(skipKind(task({ rituals: [allDay], ritualDoneDay: '2026-11-18' }), [], now, 4)).toBeNull();
    const water = { rituals: [allDay, evening], ritualPerWindow: true };
    expect(skipKind(task({ ...water, ritualDoneSlots: ['2026-11-18#0'] }), [], now, 4)).toBe('ritual');
    expect(skipKind(task({ ...water, ritualDoneSlots: ['2026-11-18#0', '2026-11-18#1'] }), [], now, 4))
      .toBeNull();
  });
});

describe('skip marks', () => {
  it('a once-a-day ritual whose day was skipped reads as skipped, not done', () => {
    const t = task({ rituals: [allDay], ritualDoneDay: '2026-11-18', ritualSkips: ['2026-11-18'] });
    expect(onlySkippedToday(t, now, 4)).toBe(true);
    expect(skippedToday(t, now, 4)).toBe(true);
    // Yesterday's skip says nothing about today.
    const old = task({ rituals: [allDay], ritualDoneDay: '2026-11-18', ritualSkips: ['2026-11-17'] });
    expect(onlySkippedToday(old, now, 4)).toBe(false);
    expect(skippedToday(old, now, 4)).toBe(false);
  });

  it('a per-window ritual is skip-only when every mark today is a skip', () => {
    const water = { rituals: [allDay, evening], ritualPerWindow: true };
    const mixed = task({
      ...water, ritualDoneSlots: ['2026-11-18#0', '2026-11-18#1'], ritualSkips: ['2026-11-18#1'],
    });
    expect(onlySkippedToday(mixed, now, 4)).toBe(false);
    expect(skippedToday(mixed, now, 4)).toBe(true);
    const skipped = task({ ...water, ritualDoneSlots: ['2026-11-18#0'], ritualSkips: ['2026-11-18#0'] });
    expect(onlySkippedToday(skipped, now, 4)).toBe(true);
  });
});
