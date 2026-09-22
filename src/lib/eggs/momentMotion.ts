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
