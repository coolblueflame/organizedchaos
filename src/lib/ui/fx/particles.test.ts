import { describe, expect, it } from 'vitest';
import { stepParticle, type Particle } from './particles';

const make = (over: Partial<Particle> = {}): Particle => ({
  x: 0, y: 0, vx: 100, vy: -200, life: 1, decay: 1,
  size: 4, color: '#fff', rot: 0, spin: 2, shape: 'square', ...over,
});

describe('stepParticle', () => {
  it('applies gravity (vy increases over time)', () => {
    const p = make();
    const vy0 = p.vy;
    stepParticle(p, 0.016);
    expect(p.vy).toBeGreaterThan(vy0);
  });

  it('applies drag (|vx| shrinks)', () => {
    const p = make();
    stepParticle(p, 0.016);
    expect(Math.abs(p.vx)).toBeLessThan(100);
  });

  it('moves by velocity and spins', () => {
    const p = make();
    stepParticle(p, 0.1);
    expect(p.x).toBeGreaterThan(0);
    expect(p.rot).toBeGreaterThan(0);
  });

  it('dies when life runs out (decay 1 ⇒ ~1s lifetime)', () => {
    const p = make();
    let alive = true;
    for (let i = 0; i < 70 && alive; i++) alive = stepParticle(p, 0.016);
    expect(alive).toBe(false);
  });
});
