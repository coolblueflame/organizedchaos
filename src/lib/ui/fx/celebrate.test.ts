import { beforeEach, describe, expect, it, vi } from 'vitest';

/** Capture what reaches the particle engine without drawing anything. */
const bursts: Array<{ x: number; y: number; opts: Record<string, unknown> }> = [];
vi.mock('./particles', () => ({
  burstAt: (x: number, y: number, opts: Record<string, unknown> = {}) =>
    bursts.push({ x, y, opts }),
}));

const { celebrateCompletion } = await import('./celebrate');

/** A deterministic rng that walks a fixed script, then holds the last value. */
const scripted = (values: number[]) => {
  let i = 0;
  return () => values[Math.min(i++, values.length - 1)]!;
};

beforeEach(() => {
  bursts.length = 0;
  vi.useFakeTimers();
});

describe('completion celebrations', () => {
  it('varies the look between completions', () => {
    // Same day, same count — only the draw differs, and it should show.
    const shapes = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      bursts.length = 0;
      celebrateCompletion(10, 10, { completionsToday: 1, rng: scripted([0.9, i / 5, 0.5]) });
      shapes.add(JSON.stringify(bursts[0]?.opts));
    }
    expect(shapes.size).toBeGreaterThan(1);
  });

  it('gets bigger as the day goes on', () => {
    const countFor = (completionsToday: number) => {
      bursts.length = 0;
      // Same texture each time (rng script fixed) so only the ramp varies.
      celebrateCompletion(10, 10, { completionsToday, rng: scripted([0.9, 0, 0]) });
      return bursts[0]!.opts.count as number;
    };
    const first = countFor(1);
    const tenth = countFor(10);
    const twentieth = countFor(20);
    expect(tenth).toBeGreaterThan(first);
    expect(twentieth).toBeGreaterThan(tenth);
  });

  it('caps the ramp so a long day never becomes a screen wipe', () => {
    bursts.length = 0;
    celebrateCompletion(10, 10, { completionsToday: 500, rng: scripted([0.9, 0, 0]) });
    expect(bursts[0]!.opts.count as number).toBeLessThan(60);
  });

  it('the current-task card celebrates harder than a list row', () => {
    bursts.length = 0;
    celebrateCompletion(10, 10, { completionsToday: 1, rng: scripted([0.9, 0, 0]) });
    const plain = bursts[0]!.opts.power as number;
    bursts.length = 0;
    celebrateCompletion(10, 10, { completionsToday: 1, emphatic: true, rng: scripted([0.9, 0, 0]) });
    expect(bursts[0]!.opts.power as number).toBeGreaterThan(plain);
  });

  it('rarely does something much louder', () => {
    // The rare roll fires several volleys, some of them delayed.
    celebrateCompletion(10, 10, { completionsToday: 1, rng: scripted([0.001, 0.5]) });
    const immediate = bursts.length;
    expect(immediate).toBeGreaterThan(1);
    vi.advanceTimersByTime(1000);
    expect(bursts.length).toBeGreaterThan(immediate);
  });

  it('an ordinary completion is a single burst, not a barrage', () => {
    celebrateCompletion(10, 10, { completionsToday: 1, rng: scripted([0.9, 0.3, 0.3]) });
    vi.advanceTimersByTime(1000);
    expect(bursts).toHaveLength(1);
  });
});
