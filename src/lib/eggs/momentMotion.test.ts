import { describe, expect, it } from 'vitest';
import {
  cardStep, cascadeCard, crossingSpeed, diePips, lavaBlob, metaballField, moveLavaBlob, streakSpawn,
} from './momentMotion';

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

describe('the solitaire cascade', () => {
  const W = 390;
  const H = 844;

  it('bounces off the bottom edge and never rests below it, each bounce lower than the last', () => {
    const c = cascadeCard(W, H, 44, 62, true, () => 0.5, '♠');
    const rebounds: number[] = [];
    let prevVy = c.vy;
    for (let i = 0; i < 2000 && c.alive; i++) {
      cardStep(c, 1 / 60, W, H);
      expect(c.y + c.h).toBeLessThanOrEqual(H + 1e-9);
      if (prevVy > 0 && c.vy < 0) rebounds.push(-c.vy);
      prevVy = c.vy;
    }
    expect(rebounds.length, 'it bounced').toBeGreaterThan(1);
    for (let i = 1; i < rebounds.length; i++) expect(rebounds[i]!).toBeLessThan(rebounds[i - 1]!);
  });

  it('leaves the screen on the far side from where it started', () => {
    const fromRight = cascadeCard(W, H, 44, 62, true, () => 0.5, '♥');
    const fromLeft = cascadeCard(W, H, 44, 62, false, () => 0.5, '♣');
    expect(fromRight.vx).toBeLessThan(0);
    expect(fromLeft.vx).toBeGreaterThan(0);
    for (let i = 0; i < 2000 && fromRight.alive; i++) cardStep(fromRight, 1 / 60, W, H);
    expect(fromRight.alive).toBe(false);
    expect(fromRight.x).toBeLessThan(0);
  });
});

describe('the lava lamp', () => {
  const blob = (x: number, y: number, r: number) => ({ x, y, r, baseX: x, phase: 0, speed: 0, sway: 0 });

  it('is wax at a blob and clear far from it', () => {
    const b = [blob(10, 10, 4)];
    expect(metaballField(10, 10, b)).toBeGreaterThanOrEqual(1);
    expect(metaballField(40, 40, b)).toBeLessThan(1);
  });

  it('joins two blobs as they near each other, before they touch', () => {
    // Midpoint between two radius-4 blobs: apart, the gap is clear; close,
    // the summed field bridges it — the gooey join.
    const apart = [blob(0, 0, 4), blob(14, 0, 4)];
    const near = [blob(0, 0, 4), blob(9, 0, 4)];
    expect(metaballField(7, 0, apart)).toBeLessThan(1);
    expect(metaballField(4.5, 0, near)).toBeGreaterThanOrEqual(1);
  });

  it('keeps every blob inside the lamp as it rises and sinks', () => {
    const b = lavaBlob(60, 120, () => 0.5);
    for (let t = 0; t < 60; t += 0.25) {
      moveLavaBlob(b, t, 120);
      expect(b.y).toBeGreaterThanOrEqual(0);
      expect(b.y).toBeLessThanOrEqual(120);
    }
  });
});

describe('diePips', () => {
  it('has as many pips as the face, inside the unit square', () => {
    for (let face = 1; face <= 6; face++) {
      const pips = diePips(face);
      expect(pips).toHaveLength(face);
      for (const [x, y] of pips) {
        expect(x).toBeGreaterThan(0); expect(x).toBeLessThan(1);
        expect(y).toBeGreaterThan(0); expect(y).toBeLessThan(1);
      }
    }
  });
});
