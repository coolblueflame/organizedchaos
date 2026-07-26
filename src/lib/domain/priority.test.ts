import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './types';
import { derivedPriority, effectivePriority, isEscalated } from './priority';

const now = new Date('2026-07-15T12:00:00');

/** Deadline key `daysAway` calendar days from `now`. */
const dl = (daysAway: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + daysAway);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('derivedPriority — spec §4 calibration (2h estimate, 1h/day)', () => {
  const cases: Array<[number, string]> = [
    [0, 'max'], [1, 'max'], [2, 'max'],   // slack ≤ 0
    [3, 'high'], [5, 'high'],             // slack 1–3
    [6, 'medium'], [8, 'medium'],         // slack 4–6
    [9, 'low'], [30, 'low'],              // slack ≥ 7 → floor
  ];
  for (const [days, expected] of cases) {
    it(`deadline in ${days} days → ${expected}`, () => {
      expect(derivedPriority({ deadline: dl(days), estimateHours: 2 }, DEFAULT_SETTINGS, now)).toBe(expected);
    });
  }

  it('overdue → max', () => {
    expect(derivedPriority({ deadline: dl(-3), estimateHours: 2 }, DEFAULT_SETTINGS, now)).toBe('max');
  });

  it('no deadline → null', () => {
    expect(derivedPriority({ deadline: undefined }, DEFAULT_SETTINGS, now)).toBeNull();
  });

  it('missing estimate defaults to 1h: deadline tomorrow → max', () => {
    expect(derivedPriority({ deadline: dl(1) }, DEFAULT_SETTINGS, now)).toBe('max');
  });
});

describe('effectivePriority = max(manual, derived)', () => {
  it('deadline only ever escalates: manual max + far deadline stays max', () => {
    expect(effectivePriority({ priority: 'max', deadline: dl(60), estimateHours: 1 }, DEFAULT_SETTINGS, now)).toBe('max');
  });

  it('manual someday + far deadline floors at low', () => {
    expect(effectivePriority({ priority: 'someday', deadline: dl(60), estimateHours: 1 }, DEFAULT_SETTINGS, now)).toBe('low');
  });

  it('no deadline → manual as-is', () => {
    expect(effectivePriority({ priority: 'someday' }, DEFAULT_SETTINGS, now)).toBe('someday');
  });
});

describe('isEscalated', () => {
  it('true only when derived beats manual', () => {
    expect(isEscalated({ priority: 'low', deadline: dl(0) }, DEFAULT_SETTINGS, now)).toBe(true);
    expect(isEscalated({ priority: 'max', deadline: dl(0) }, DEFAULT_SETTINGS, now)).toBe(false);
    expect(isEscalated({ priority: 'low' }, DEFAULT_SETTINGS, now)).toBe(false);
  });
});
