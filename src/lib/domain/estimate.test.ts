import { describe, expect, it } from 'vitest';
import { parseEstimate } from './estimate';

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
