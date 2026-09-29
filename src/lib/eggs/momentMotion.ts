/**
 * Pacing for the drifting moments (bubbles, petals).
 *
 * A moment is on screen for a fixed, short window, so "slow and calm" has a
 * floor: bubbles set to drift at 20–65 px/s needed fifteen seconds or more to
 * climb a phone screen, and the effect ends after nine — they were still
 * halfway up when it vanished (2026-09-21 report). Tying the speed to the
 * window rather than picking pixels per second means the motion reads the
 * same on a phone and a desktop, and stays right if the window is retuned.
 */

/** Pixels per second that carries something `distance` px `crossings` times within `windowMs`. */
export function crossingSpeed(distance: number, windowMs: number, crossings = 1): number {
  if (windowMs <= 0) return 0;
  return (distance * crossings) / (windowMs / 1000);
}

/** One falling streak, in CSS pixels and pixels per second. */
export interface Streak {
  x: number; y: number;
  vx: number; vy: number;
  /** Tail length along the direction of travel. */
  len: number;
}

/**
 * A streak for the shower, either seeding the opening frame or entering from
 * off screen.
 *
 * Streaks fall down and to the LEFT, so a narrow screen runs out of width
 * long before it runs out of height: spawning them across the screen's own
 * width meant that on a 390x844 phone only 6% ever reached the bottom, and
 * the shower faded out around a third of the way down (2026-09-29 report;
 * on a 1280x720 desktop the same numbers are fine, which is why it showed up
 * on a phone). Spawning across the width the paths actually USE — the screen
 * plus the horizontal run a full-height fall costs — fills every screen shape
 * evenly, because the ones starting past the right edge enter partway down.
 */
export function streakSpawn(
  W: number, H: number, speed: number, rnd: () => number, seeding = false,
): Streak {
  const vy = speed * (0.75 + rnd() * 0.5);
  const vx = -vy * (0.45 + rnd() * 0.35);
  const len = 30 + rnd() * 60;
  // The opening frame starts mid-shower rather than waiting for arrivals —
  // the moment is seconds long and an empty first second is most of it.
  if (seeding) return { x: rnd() * W, y: rnd() * H, vx, vy, len };
  const runToBottom = H * (-vx / vy);
  return { x: rnd() * (W + runToBottom), y: -len - rnd() * H * 0.25, vx, vy, len };
}
