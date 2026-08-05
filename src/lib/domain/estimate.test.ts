import { describe, expect, it } from 'vitest';
import { formatEstimate, parseEstimate } from './estimate';

describe('parseEstimate', () => {
  it('keeps plain numbers as hours (the old behaviour)', () => {
    expect(parseEstimate('1.5')).toBe(1.5);
    expect(parseEstimate('2')).toBe(2);
    expect(parseEstimate('0,5')).toBe(0.5); // decimal comma
  });

  it('reads minutes without the mental math', () => {
    expect(parseEstimate('90m')).toBe(1.5);
    expect(parseEstimate('45 min')).toBe(0.75);
    expect(parseEstimate('30minutes')).toBe(0.5);
  });

  it('reads hours with a suffix, and mixed forms', () => {
    expect(parseEstimate('2h')).toBe(2);
    expect(parseEstimate('1.5hr')).toBe(1.5);
    expect(parseEstimate('1h30m')).toBe(1.5);
    expect(parseEstimate('1h 15m')).toBe(1.25);
    expect(parseEstimate('1:30')).toBe(1.5);
  });

  it('rejects nonsense, zero, and negatives', () => {
    expect(parseEstimate('')).toBeNull();
    expect(parseEstimate('soon')).toBeNull();
    expect(parseEstimate('0')).toBeNull();
    expect(parseEstimate('0m')).toBeNull();
    expect(parseEstimate('-2')).toBeNull();
    expect(parseEstimate('h')).toBeNull();
  });
});

describe('formatEstimate', () => {
  it('shows back what a person would have typed', () => {
    expect(formatEstimate(0.75)).toBe('45m');
    expect(formatEstimate(1.5)).toBe('1h 30m');
    expect(formatEstimate(2)).toBe('2h');
    expect(formatEstimate(0.5)).toBe('30m');
  });

  it('is empty for no estimate', () => {
    expect(formatEstimate(undefined)).toBe('');
    expect(formatEstimate(0)).toBe('');
  });

  it('round-trips through the parser', () => {
    for (const h of [0.25, 0.5, 0.75, 1, 1.5, 2, 3.25, 8]) {
      expect(parseEstimate(formatEstimate(h))).toBe(h);
    }
  });
});
