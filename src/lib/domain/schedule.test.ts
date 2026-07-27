import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type List, type Priority, type Task } from './types';
import {
  describeWindow, hasWindow, isListActiveAt, tasksBlockedByHours, WEEKDAYS, WEEKEND,
} from './schedule';

const list = (over: Partial<List> = {}): List => ({
  id: 'L1', title: 'L', sortMode: 'priority',
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

const at = (hhmm: string) => new Date(`2026-07-15T${hhmm}:00`);

describe('isListActiveAt', () => {
  it('lists without a window are always active', () => {
    expect(isListActiveAt(list(), at('03:00'))).toBe(true);
    expect(isListActiveAt(list({ activeFrom: '09:00' }), at('03:00'))).toBe(true); // half-set
  });

  it('a normal daytime window is inclusive of start, exclusive of end', () => {
    const work = list({ activeFrom: '09:00', activeTo: '17:00' });
    expect(isListActiveAt(work, at('08:59'))).toBe(false);
    expect(isListActiveAt(work, at('09:00'))).toBe(true);
    expect(isListActiveAt(work, at('16:59'))).toBe(true);
    expect(isListActiveAt(work, at('17:00'))).toBe(false);
    expect(isListActiveAt(work, at('23:30'))).toBe(false);
  });

  it('a window that wraps past midnight stays active across the boundary', () => {
    const evening = list({ activeFrom: '17:00', activeTo: '09:00' });
    expect(isListActiveAt(evening, at('16:59'))).toBe(false);
    expect(isListActiveAt(evening, at('17:00'))).toBe(true);
    expect(isListActiveAt(evening, at('23:59'))).toBe(true);
    expect(isListActiveAt(evening, at('00:30'))).toBe(true);
    expect(isListActiveAt(evening, at('08:59'))).toBe(true);
    expect(isListActiveAt(evening, at('09:00'))).toBe(false);
  });

  it('honors minute precision', () => {
    const lunch = list({ activeFrom: '12:30', activeTo: '13:15' });
    expect(isListActiveAt(lunch, at('12:29'))).toBe(false);
    expect(isListActiveAt(lunch, at('12:30'))).toBe(true);
    expect(isListActiveAt(lunch, at('13:14'))).toBe(true);
    expect(isListActiveAt(lunch, at('13:15'))).toBe(false);
  });

  it('an equal start and end is treated as unscheduled, not as zero-length', () => {
    const degenerate = list({ activeFrom: '09:00', activeTo: '09:00' });
    expect(hasWindow(degenerate)).toBe(false);
    expect(isListActiveAt(degenerate, at('03:00'))).toBe(true);
  });
});

describe('weekday rules', () => {
  // 2026-07-15 is a Wednesday; 2026-07-18 a Saturday.
  const wed = (t: string) => new Date(`2026-07-15T${t}:00`);
  const sat = (t: string) => new Date(`2026-07-18T${t}:00`);

  it('office hours on weekdays only', () => {
    const office = list({ hours: [{ days: WEEKDAYS, from: '09:00', to: '17:00' }] });
    expect(isListActiveAt(office, wed('12:00'))).toBe(true);
    expect(isListActiveAt(office, wed('20:00'))).toBe(false);
    expect(isListActiveAt(office, sat('12:00'))).toBe(false);
  });

  it('different windows on different days, via multiple rules', () => {
    const chores = list({
      hours: [
        { days: WEEKDAYS, from: '18:00', to: '21:00' }, // evenings in the week
        { days: WEEKEND, from: '10:00', to: '16:00' },  // daytime at weekends
      ],
    });
    expect(isListActiveAt(chores, wed('19:00'))).toBe(true);
    expect(isListActiveAt(chores, wed('12:00'))).toBe(false);
    expect(isListActiveAt(chores, sat('12:00'))).toBe(true);
    expect(isListActiveAt(chores, sat('19:00'))).toBe(false);
  });

  it('a window that wraps midnight belongs to the day it STARTED on', () => {
    const nightShift = list({ hours: [{ days: [5], from: '22:00', to: '02:00' }] }); // Friday nights
    const fri = (t: string) => new Date(`2026-07-17T${t}:00`);
    expect(isListActiveAt(nightShift, fri('23:00'))).toBe(true);
    expect(isListActiveAt(nightShift, sat('01:00'))).toBe(true);  // spillover into Saturday
    expect(isListActiveAt(nightShift, sat('03:00'))).toBe(false);
    expect(isListActiveAt(nightShift, sat('23:00'))).toBe(false); // Saturday night is not Friday's
  });

  it('still honours the pre-rules activeFrom/activeTo shape', () => {
    const legacy = list({ activeFrom: '09:00', activeTo: '17:00' });
    expect(isListActiveAt(legacy, wed('12:00'))).toBe(true);
    expect(isListActiveAt(legacy, sat('12:00'))).toBe(true); // all-week by definition
    expect(isListActiveAt(legacy, wed('20:00'))).toBe(false);
  });

  it('describes rules readably', () => {
    expect(describeWindow(list({ hours: [{ days: WEEKDAYS, from: '09:00', to: '17:00' }] })))
      .toBe('weekdays 9:00–17:00');
    expect(describeWindow(list({ hours: [{ days: WEEKEND, from: '10:00', to: '16:00' }] })))
      .toBe('weekends 10:00–16:00');
    expect(describeWindow(list({ hours: [{ days: [1, 3], from: '08:00', to: '09:00' }] })))
      .toBe('MoWe 8:00–9:00');
    expect(describeWindow(list())).toBeNull();
  });
});

describe('tasksBlockedByHours', () => {
  const settings = { ...DEFAULT_SETTINGS };
  const night = at('22:00');
  let n = 0;
  const task = (over: Partial<Task> & { priority: Priority; listId: string }): Task => ({
    id: `t${n++}`, name: 't', notes: '', tagIds: [], inProgress: false,
    createdAt: 0, updatedAt: 0, deleted: false, ...over,
  });

  it('blocks nothing for lists with no window, or lists currently awake', () => {
    const always = list({ id: 'A' });
    const awake = list({ id: 'B', activeFrom: '20:00', activeTo: '23:00' });
    const tasks = [task({ listId: 'A', priority: 'low' }), task({ listId: 'B', priority: 'low' })];
    expect(tasksBlockedByHours(tasks, [always, awake], settings, night)).toEqual([]);
  });

  it('blocks everything on an asleep list without the override', () => {
    const work = list({ id: 'W', activeFrom: '09:00', activeTo: '17:00' });
    const low = task({ listId: 'W', priority: 'low' });
    const max = task({ listId: 'W', priority: 'max' });
    expect(tasksBlockedByHours([low, max], [work], settings, night).sort())
      .toEqual([low.id, max.id].sort());
  });

  it('lets MAX-priority through on an asleep list WITH the override', () => {
    const work = list({ id: 'W', activeFrom: '09:00', activeTo: '17:00', urgentOverridesHours: true });
    const low = task({ listId: 'W', priority: 'low' });
    const high = task({ listId: 'W', priority: 'high' });
    const max = task({ listId: 'W', priority: 'max' });
    expect(tasksBlockedByHours([low, high, max], [work], settings, night).sort())
      .toEqual([low.id, high.id].sort());
  });

  it('counts EFFECTIVE priority, so an overdue task escalates through the override', () => {
    const work = list({ id: 'W', activeFrom: '09:00', activeTo: '17:00', urgentOverridesHours: true });
    // manually "low", but overdue → effective max
    const overdue = task({ listId: 'W', priority: 'low', deadline: '2026-07-01' });
    expect(tasksBlockedByHours([overdue], [work], settings, night)).toEqual([]);
  });

  it('blocks tasks whose list is gone only when the list exists (orphans pass through)', () => {
    const orphan = task({ listId: 'missing', priority: 'low' });
    expect(tasksBlockedByHours([orphan], [], settings, night)).toEqual([]);
  });
});

describe('describeWindow', () => {
  it('formats a compact label and returns null when unscheduled', () => {
    expect(describeWindow(list({ activeFrom: '09:00', activeTo: '17:00' }))).toBe('9:00–17:00');
    expect(describeWindow(list())).toBeNull();
  });
});
