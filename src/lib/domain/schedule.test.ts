import { describe, expect, it } from 'vitest';
import type { List } from './types';
import { describeWindow, hasWindow, isListActiveAt } from './schedule';

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

describe('describeWindow', () => {
  it('formats a compact label and returns null when unscheduled', () => {
    expect(describeWindow(list({ activeFrom: '09:00', activeTo: '17:00' }))).toBe('9:00–17:00');
    expect(describeWindow(list())).toBeNull();
  });
});
