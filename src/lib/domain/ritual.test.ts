import { describe, expect, it } from 'vitest';
import { ALL_DAYS, WEEKDAYS, type HoursRule } from './schedule';
import { describeRitual, isRitualDue, ritualExclusions, ritualLifts, ritualState, withRitualLifts } from './ritual';
import { DEFAULT_SETTINGS, type Task } from './types';

const settings = { ...DEFAULT_SETTINGS, rolloverHour: 4 };

let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${n++}`, listId: 'L1', name: 'eat lunch', notes: '', tagIds: [],
  priority: 'low', inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

const LUNCH: HoursRule = { days: ALL_DAYS, from: '12:00', to: '14:00' };
const at = (hhmm: string, day = '2026-07-28') => new Date(`${day}T${hhmm}:00`);

describe('ritualState', () => {
  it('is nothing at all for an ordinary task', () => {
    expect(ritualState(task(), at('12:30'), 4)).toBeNull();
  });

  it('is due inside the window when it has not been done today', () => {
    expect(ritualState(task({ ritual: LUNCH }), at('12:30'), 4)).toBe('due');
  });

  it('waits outside the window', () => {
    expect(ritualState(task({ ritual: LUNCH }), at('09:00'), 4)).toBe('waiting');
    expect(ritualState(task({ ritual: LUNCH }), at('15:00'), 4)).toBe('waiting');
  });

  it('is done once today, whatever the clock says', () => {
    const done = task({ ritual: LUNCH, ritualDoneDay: '2026-07-28' });
    expect(ritualState(done, at('12:30'), 4)).toBe('done');
    expect(ritualState(done, at('23:00'), 4)).toBe('done');
  });

  it('comes back the next day rather than piling up', () => {
    // The whole point: yesterday's is not owed to you. It simply comes round again.
    const done = task({ ritual: LUNCH, ritualDoneDay: '2026-07-27' });
    expect(ritualState(done, at('12:30'), 4)).toBe('due');
  });

  it('a day missed entirely leaves nothing behind', () => {
    const stale = task({ ritual: LUNCH, ritualDoneDay: '2026-07-20' });
    expect(ritualState(stale, at('09:00'), 4), 'still just waiting for its window').toBe('waiting');
    expect(ritualState(stale, at('12:30'), 4), 'and due once, not eight times').toBe('due');
  });

  it('respects the day rollover rather than midnight', () => {
    // A wind-down ritual done at 00:30 belongs to the day that is still ending.
    const night: HoursRule = { days: ALL_DAYS, from: '22:00', to: '01:00' };
    const done = task({ ritual: night, ritualDoneDay: '2026-07-27' });
    expect(ritualState(done, at('00:30', '2026-07-28'), 4), 'same app-day').toBe('done');
    expect(ritualState(done, at('22:30', '2026-07-28'), 4), 'next evening').toBe('due');
  });

  it('honours the weekday filter', () => {
    const standup = task({ ritual: { days: WEEKDAYS, from: '09:00', to: '10:00' } });
    expect(isRitualDue(standup, at('09:30', '2026-07-27'), 4), 'Monday').toBe(true);
    expect(isRitualDue(standup, at('09:30', '2026-07-26'), 4), 'Sunday').toBe(false);
  });
});

describe('feeding the draw', () => {
  it('excludes every ritual that is not due right now', () => {
    const due = task({ ritual: LUNCH, id: 'due' });
    const waiting = task({ ritual: LUNCH, id: 'waiting', ritualDoneDay: '2026-07-28' });
    const ordinary = task({ id: 'ordinary' });
    const excluded = ritualExclusions([due, waiting, ordinary], settings, at('12:30'));
    expect(excluded).toEqual(['waiting']);
  });

  it('a due ritual outranks everything else', () => {
    const lunch = task({ ritual: LUNCH, id: 'lunch', priority: 'low' });
    expect(ritualLifts([lunch, task()], settings, at('12:30')).get('lunch')).toBe('max');
  });

  it('lifts nothing outside the window', () => {
    expect(ritualLifts([task({ ritual: LUNCH })], settings, at('16:00')).size).toBe(0);
  });

  it('merges over the blocking lifts without discarding them', () => {
    const lunch = task({ ritual: LUNCH, id: 'lunch' });
    const blocker = task({ id: 'blocker' });
    const merged = withRitualLifts(
      new Map([['blocker', 'high' as const]]), [lunch, blocker], settings, at('12:30'),
    );
    expect(merged.get('blocker')).toBe('high');
    expect(merged.get('lunch')).toBe('max');
  });
});

describe('describeRitual', () => {
  it('names the common shapes', () => {
    expect(describeRitual(LUNCH)).toBe('every day 12:00–14:00');
    expect(describeRitual({ days: WEEKDAYS, from: '09:00', to: '10:00' })).toBe('weekdays 09:00–10:00');
    expect(describeRitual({ days: [0, 6], from: '10:00', to: '12:00' })).toBe('weekends 10:00–12:00');
    expect(describeRitual({ days: [1, 3], from: '18:00', to: '19:00' })).toBe('Mon Wed 18:00–19:00');
  });
});
