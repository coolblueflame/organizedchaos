import { describe, expect, it } from 'vitest';
import { SPARKLE_SPOTS, SPARKLE_STORY_BEAT, sparkleFound, sparkleSpot, sparkleTally } from './sparkles';
import { STORY_BEATS } from './content/extras';

/** `count` consecutive app-days starting at `from`. */
function days(from: string, count: number): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T12:00:00Z`);
  for (let i = 0; i < count; i++) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

describe('ENTROPY’s sparkles', () => {
  it('start with the story beat that announced them', () => {
    expect(STORY_BEATS[SPARKLE_STORY_BEAT]).toMatch(/sparkle/);
  });

  it('hide in the same spot for everyone on the same day', () => {
    expect(sparkleSpot('2026-10-03')).toBe(sparkleSpot('2026-10-03'));
  });

  it('never hide on the same screen two days running', () => {
    const run = days('2026-01-01', 400).map(sparkleSpot);
    for (let i = 1; i < run.length; i++) expect(run[i], `day ${i}`).not.toBe(run[i - 1]);
  });

  it('visit every screen once in each stretch of as many days as there are screens', () => {
    // Blocks are counted from the epoch, so line the window up with one.
    const n = SPARKLE_SPOTS.length;
    const epochDay = Math.round(Date.UTC(2026, 0, 1) / 86_400_000);
    const start = new Date((epochDay + (n - (epochDay % n)) % n) * 86_400_000).toISOString().slice(0, 10);
    const run = days(start, n * 50).map(sparkleSpot);
    for (let b = 0; b < 50; b++) {
      expect(new Set(run.slice(b * n, (b + 1) * n)).size, `block ${b}`).toBe(n);
    }
  });

  it('crosses month and year ends without losing a day', () => {
    expect(days('2026-12-31', 2)).toEqual(['2026-12-31', '2027-01-01']);
    expect(sparkleSpot('2027-01-01')).not.toBe(sparkleSpot('2026-12-31'));
  });

  it('counts what was found, and only sparkles', () => {
    const marks = { 'sparkle:2026-10-01': 1, 'sparkle:2026-10-03': 2, 'moment:aurora': 3 };
    expect(sparkleTally(marks)).toBe(2);
    expect(sparkleFound(marks, '2026-10-03')).toBe(true);
    expect(sparkleFound(marks, '2026-10-02')).toBe(false);
  });
});
