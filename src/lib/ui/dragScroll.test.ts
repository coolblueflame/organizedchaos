import { describe, expect, it } from 'vitest';
import { edgeSpeed } from './dragScroll';

describe('edgeSpeed', () => {
  it('is zero outside the band and positive inside it', () => {
    expect(edgeSpeed(0)).toBe(0);
    expect(edgeSpeed(-10)).toBe(0);
    expect(edgeSpeed(1)).toBeGreaterThan(0);
  });

  it('ramps monotonically — deeper into the band is never slower', () => {
    let last = 0;
    for (let d = 0; d <= 96; d += 8) {
      const v = edgeSpeed(d);
      expect(v).toBeGreaterThanOrEqual(last);
      last = v;
    }
  });

  it('creeps at the band edge and flies at the screen edge, bounded', () => {
    expect(edgeSpeed(8)).toBeLessThanOrEqual(4);   // gentle entry
    expect(edgeSpeed(96)).toBe(26);                // full speed at the edge
    expect(edgeSpeed(500)).toBe(26);               // never past the cap
  });
});
