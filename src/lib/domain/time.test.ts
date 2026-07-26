import { describe, expect, it } from 'vitest';
import { addDaysKey, appDayKey, daysUntilDeadline, nextRollover } from './time';

/** Local-time ISO without a zone suffix parses as local time. */
const at = (s: string) => new Date(s);

describe('appDayKey (4am rollover)', () => {
  it('2am belongs to the previous day', () => {
    expect(appDayKey(at('2026-07-15T02:00:00'), 4)).toBe('2026-07-14');
  });

  it('4am starts the new day; 3:59 does not', () => {
    expect(appDayKey(at('2026-07-15T04:00:00'), 4)).toBe('2026-07-15');
    expect(appDayKey(at('2026-07-15T03:59:59'), 4)).toBe('2026-07-14');
  });

  it('noon is plainly today', () => {
    expect(appDayKey(at('2026-07-15T12:00:00'), 4)).toBe('2026-07-15');
  });

  it('month boundary: 1st at 1am is still last month', () => {
    expect(appDayKey(at('2026-08-01T01:00:00'), 4)).toBe('2026-07-31');
  });
});

describe('nextRollover', () => {
  it('before 4am → 4am today', () => {
    expect(nextRollover(at('2026-07-15T02:00:00'), 4).getTime())
      .toBe(at('2026-07-15T04:00:00').getTime());
  });

  it('after 4am → 4am tomorrow', () => {
    expect(nextRollover(at('2026-07-15T10:00:00'), 4).getTime())
      .toBe(at('2026-07-16T04:00:00').getTime());
  });

  it('exactly 4am → 4am tomorrow (strictly future)', () => {
    expect(nextRollover(at('2026-07-15T04:00:00'), 4).getTime())
      .toBe(at('2026-07-16T04:00:00').getTime());
  });
});

describe('daysUntilDeadline', () => {
  it('deadline today → 0', () => {
    expect(daysUntilDeadline('2026-07-15', at('2026-07-15T12:00:00'), 4)).toBe(0);
  });

  it('2am still counts as yesterday, so a deadline of "yesterday" is 0 not -1', () => {
    expect(daysUntilDeadline('2026-07-15', at('2026-07-16T02:00:00'), 4)).toBe(0);
  });

  it('future and past', () => {
    expect(daysUntilDeadline('2026-07-18', at('2026-07-15T12:00:00'), 4)).toBe(3);
    expect(daysUntilDeadline('2026-07-14', at('2026-07-15T12:00:00'), 4)).toBe(-1);
  });
});

describe('addDaysKey', () => {
  it('crosses month ends', () => {
    expect(addDaysKey('2026-07-30', 3)).toBe('2026-08-02');
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28');
  });
});
