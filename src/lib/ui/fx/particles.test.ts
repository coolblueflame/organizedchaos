import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bindCanvas, burstAt, stepParticle, type Particle } from './particles';

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

describe('the render loop always has a way back', () => {
  /*
    2026-09-21: a screenshot of confetti standing still across the home
    screen. requestAnimationFrame does not run while a page is hidden, and
    iOS drops the queued callback when it suspends and restores a page — so
    the loop could stop with `rafId` still set, which froze the last frame
    AND made every later celebration invisible (ensureLoop believed the dead
    id). These drive the module through a fake canvas and fake frame clock.
  */
  let clock = 0;
  let scheduled: Array<(ts: number) => void> = [];
  let rafCalls = 0;
  let clears = 0;
  let visibility = 'visible';
  let listeners: Record<string, Array<() => void>> = {};

  const ctxStub = {
    setTransform: () => {},
    clearRect: () => { clears += 1; },
    beginPath: () => {}, arc: () => {}, fill: () => {}, fillRect: () => {},
    save: () => {}, restore: () => {}, translate: () => {}, rotate: () => {},
    globalAlpha: 1, fillStyle: '',
  };

  /** Run the frame the loop last asked for, if any. */
  function runFrame(ms = 16) {
    clock += ms;
    const next = scheduled.shift();
    next?.(clock);
  }

  // The module keeps one pool and one loop id for the page's lifetime, so
  // every test unbinds to hand the next one a clean slate.
  let unbind = () => {};
  afterEach(() => unbind());

  beforeEach(() => {
    clock = 0; scheduled = []; rafCalls = 0; clears = 0;
    visibility = 'visible'; listeners = {};
    vi.stubGlobal('performance', { now: () => clock });
    vi.stubGlobal('requestAnimationFrame', (cb: (ts: number) => void) => {
      rafCalls += 1; scheduled.push(cb); return rafCalls;
    });
    vi.stubGlobal('cancelAnimationFrame', () => { scheduled = []; });
    vi.stubGlobal('window', {
      innerWidth: 400, innerHeight: 800, devicePixelRatio: 3,
      addEventListener: () => {}, removeEventListener: () => {},
    });
    vi.stubGlobal('document', {
      get visibilityState() { return visibility; },
      addEventListener: (ev: string, fn: () => void) => {
        (listeners[ev] ??= []).push(fn);
      },
      removeEventListener: () => {},
    });
    unbind = bindCanvas({ getContext: () => ctxStub } as unknown as HTMLCanvasElement);
  });

  it('leaving the app clears the screen instead of freezing a frame on it', () => {
    burstAt(200, 400, { count: 10 });
    runFrame();
    const before = clears;
    visibility = 'hidden';
    for (const fn of listeners['visibilitychange'] ?? []) fn();
    expect(clears, 'the canvas is wiped on the way out').toBeGreaterThan(before);
    // Nothing is left in flight, so nothing can be painted while away.
    const framesAsked = rafCalls;
    runFrame();
    expect(rafCalls).toBe(framesAsked);
  });

  it('a celebration after a loop has died starts a new one', () => {
    burstAt(200, 400, { count: 10 });
    const first = rafCalls;
    expect(first).toBeGreaterThan(0);
    // The frame never runs: the page was suspended and the callback dropped.
    scheduled = [];
    clock += 5000;
    burstAt(200, 400, { count: 10 });
    expect(rafCalls, 'the stale id is replaced, not believed').toBeGreaterThan(first);
    runFrame();
    expect(clears).toBeGreaterThan(0);
  });

  it('a live loop is not restarted by every burst', () => {
    burstAt(200, 400, { count: 10 });
    const first = rafCalls;
    runFrame(); // the loop is alive and asked for its next frame
    const afterFrame = rafCalls;
    burstAt(210, 410, { count: 10 });
    expect(rafCalls, 'one loop, not two').toBe(afterFrame);
    expect(afterFrame).toBeGreaterThan(first);
  });

  it('runs itself dry and wipes the canvas when the last particle dies', () => {
    burstAt(200, 400, { count: 6 });
    for (let i = 0; i < 400 && scheduled.length > 0; i++) runFrame(50);
    expect(scheduled, 'the loop stopped on its own').toHaveLength(0);
    expect(clears).toBeGreaterThan(0);
  });
});
