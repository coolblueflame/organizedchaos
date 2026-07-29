/**
 * A shared ticking "now" for time-derived UI.
 *
 * A `$derived` that calls `new Date()` bakes in the moment its dependencies
 * last changed and then goes stale as real time passes — the frozen-clock bug
 * class (first seen in the current-task elapsed readout, then again in the
 * ritual/hours gating, where a lunch window could open while the randomizer
 * screen sat there still excluding it). Reading `clock.now` instead makes the
 * derived re-evaluate every tick and immediately on tab resume, which is when
 * a PWA most often wakes across a window boundary.
 *
 * 20s granularity: window boundaries are minutes-grained, so a boundary is
 * never observed more than 20s late, and a whole screen of deriveds
 * re-running at that cadence is microseconds of work.
 *
 * Store mutations keep taking their own `new Date()` — the clock is for
 * DERIVED eligibility and display, not for stamping data.
 */
const TICK_MS = 20_000;

class Clock {
  now = $state(new Date());

  constructor() {
    if (typeof window === 'undefined') return;
    setInterval(() => (this.now = new Date()), TICK_MS);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.now = new Date();
    });
    // Deterministic hook for tests: Playwright's mocked clocks land AFTER this
    // module booted, and nudging via synthetic visibility events proved
    // engine-dependent. The harness pokes the clock directly instead.
    (window as unknown as { __ocTickClock?: () => void }).__ocTickClock = () =>
      (this.now = new Date());
  }
}

export const clock = new Clock();
