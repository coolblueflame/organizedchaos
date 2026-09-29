import { describe, expect, it } from 'vitest';
import { crossingSpeed, streakSpawn } from './momentMotion';

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

describe('streakSpawn', () => {
  /** Where the shower spends its visible time, as five bands top to bottom. */
  function occupancy(W: number, H: number, spawn: () => ReturnType<typeof streakSpawn>) {
    const bands = [0, 0, 0, 0, 0];
    let total = 0;
    for (let i = 0; i < 4000; i++) {
      const s = spawn();
      for (;;) {
        s.x += s.vx / 60;
        s.y += s.vy / 60;
        if (s.x >= -s.len && s.x <= W + s.len && s.y >= 0 && s.y <= H) {
          bands[Math.min(4, Math.floor((s.y / H) * 5))]! += 1;
          total += 1;
        }
        if (s.y > H + s.len || s.x < -s.len) break;
      }
    }
    return bands.map((n) => n / total);
  }

  it('fills a phone screen evenly, top to bottom', () => {
    // The 2026-09-29 report measured: the old spawn put 39% of its visible
    // time in the top fifth and 5% in the bottom one, so the shower visibly
    // died out before the bottom of a phone.
    const W = 390;
    const H = 844;
    const speed = crossingSpeed(H, 9000, 6);
    const bands = occupancy(W, H, () => streakSpawn(W, H, speed, Math.random));
    for (const [i, share] of bands.entries()) {
      expect(share, `band ${i} of 5 carries its share`).toBeGreaterThan(0.12);
    }
    expect(Math.max(...bands) / Math.min(...bands), 'no band starves').toBeLessThan(1.6);
  });

  it('is still even on a wide screen, where the old numbers already worked', () => {
    const W = 1280;
    const H = 720;
    const bands = occupancy(W, H, () => streakSpawn(W, H, crossingSpeed(H, 9000, 6), Math.random));
    expect(Math.min(...bands)).toBeGreaterThan(0.12);
  });

  it('travels down and to the left, tail trailing behind', () => {
    const s = streakSpawn(390, 844, 500, () => 0.5);
    expect(s.vy).toBeGreaterThan(0);
    expect(s.vx).toBeLessThan(0);
    expect(s.len).toBeGreaterThan(0);
  });

  it('seeds the opening frame on screen, and later ones above it', () => {
    const seeded = streakSpawn(390, 844, 500, () => 0.5, true);
    expect(seeded.y).toBeGreaterThanOrEqual(0);
    expect(seeded.y).toBeLessThanOrEqual(844);
    const entering = streakSpawn(390, 844, 500, () => 0.5);
    expect(entering.y).toBeLessThan(0);
    // Past the right edge is the whole point: those enter partway down.
    expect(entering.x).toBeGreaterThan(390);
  });
});
