import { describe, expect, it } from 'vitest';
import { crossingSpeed } from './momentMotion';

describe('crossingSpeed', () => {
  it('carries a drifter the whole way within the window it is on screen for', () => {
    // The 2026-09-21 report in one assertion: a bubble starting at the bottom
    // of a phone screen must reach the top before the moment ends.
    const H = 659;
    const windowMs = 9000;
    const speed = crossingSpeed(H, windowMs, 1);
    expect(speed * (windowMs / 1000)).toBeGreaterThanOrEqual(H);
    // The old hand-picked numbers could not: 65 px/s needed ten seconds.
    expect(speed).toBeGreaterThan(65);
  });

  it('scales with the distance, so a tall screen is not slower to cross', () => {
    expect(crossingSpeed(1200, 9000)).toBeCloseTo(2 * crossingSpeed(600, 9000));
  });

  it('more crossings means proportionally faster', () => {
    expect(crossingSpeed(600, 9000, 2)).toBeCloseTo(2 * crossingSpeed(600, 9000, 1));
  });

  it('a window of nothing asks for no motion rather than infinite speed', () => {
    expect(crossingSpeed(600, 0)).toBe(0);
  });
});
