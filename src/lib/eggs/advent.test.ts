import { describe, expect, it } from 'vitest';
import { ADVENT_DOORS, GIFTS, adventKey, calendarUp, doorEverOpened, doorsOpenable } from './advent';
import { MOMENTS } from './registry';

describe('ENTROPY’s winter calendar', () => {
  it('opens one more door each December day, all of them by the 24th, none outside December', () => {
    expect(doorsOpenable('2026-11-30')).toBe(0);
    expect(doorsOpenable('2026-12-01')).toBe(1);
    expect(doorsOpenable('2026-12-05')).toBe(5);
    expect(doorsOpenable('2026-12-24')).toBe(ADVENT_DOORS);
    expect(doorsOpenable('2026-12-30')).toBe(ADVENT_DOORS);
    expect(doorsOpenable('2027-01-01')).toBe(0);
  });

  it('hangs through December, even on a December birthday, and comes down for New Year or with touches off', () => {
    expect(calendarUp('winter', '2026-12-05')).toBe(true);
    expect(calendarUp('birthday', '2026-12-05'), 'a birthday outranks winter for its day').toBe(true);
    expect(calendarUp('new-year', '2026-12-31')).toBe(false);
    expect(calendarUp(null, '2026-12-05'), 'seasonal touches off').toBe(false);
    expect(calendarUp('birthday', '2026-07-05')).toBe(false);
  });

  it('has a gift behind every door, in reader-safe words, whose moments exist', () => {
    expect(GIFTS).toHaveLength(ADVENT_DOORS);
    for (const g of GIFTS) {
      expect(g.text.length, g.text).toBeLessThanOrEqual(200);
      expect(g.text, 'no em dashes in reader copy').not.toContain('—');
      if (g.moment) expect(MOMENTS as readonly string[]).toContain(g.moment);
    }
  });

  it('remembers an opened door by its number in any year, and never mistakes 2 for 12', () => {
    expect(adventKey(2026, 12)).toBe('advent:2026-12');
    expect(doorEverOpened({ 'advent:2025-12': 1 }, 12)).toBe(true);
    expect(doorEverOpened({ 'advent:2026-2': 1 }, 12)).toBe(false);
    expect(doorEverOpened({ 'advent:2026-12': 1 }, 2)).toBe(false);
  });
});
