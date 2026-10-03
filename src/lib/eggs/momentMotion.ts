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

/** One card of the solitaire cascade, in CSS pixels and pixels per second. */
export interface CascadeCard {
  x: number; y: number; vx: number; vy: number;
  w: number; h: number; suit: string;
  /** False once it has left the screen sideways. */
  alive: boolean;
}

/** How much of its speed a card keeps when it bounces off the bottom edge. */
export const CARD_BOUNCE = 0.78;

/**
 * A card springing off a foundation pile at the top of the screen, heading
 * for the far side. Speeds scale with the screen so the arc reads the same on
 * a phone and a desktop.
 */
export function cascadeCard(
  W: number, H: number, w: number, h: number, fromRight: boolean, rnd: () => number, suit: string,
): CascadeCard {
  const speed = W * (0.2 + rnd() * 0.25);
  return {
    x: fromRight ? W - w - rnd() * W * 0.2 : rnd() * W * 0.2,
    y: H * 0.04,
    vx: fromRight ? -speed : speed,
    vy: -H * (0.1 + rnd() * 0.35),
    w, h, suit, alive: true,
  };
}

/**
 * Advance a card by `dt` seconds: gravity, a damped bounce off the bottom
 * edge (never resting below it), retired once it has left the screen
 * sideways.
 */
export function cardStep(c: CascadeCard, dt: number, W: number, H: number): void {
  c.vy += H * 2.6 * dt;
  c.x += c.vx * dt;
  c.y += c.vy * dt;
  if (c.y + c.h > H) {
    c.y = H - c.h;
    c.vy = -Math.abs(c.vy) * CARD_BOUNCE;
  }
  if (c.x < -c.w || c.x > W + c.w) c.alive = false;
}

/** One blob of the lava lamp, in field-grid cells. */
export interface LavaBlob {
  x: number; y: number; r: number;
  baseX: number; phase: number; speed: number; sway: number;
}

/**
 * A blob somewhere in a `gw` × `gh` field, with its own pace and drift.
 * `slot` of `of` spreads the blobs' starting heights around the lamp's cycle,
 * so a freshly lit lamp has wax at every height instead of one clump.
 */
export function lavaBlob(gw: number, gh: number, rnd: () => number, slot = 0, of = 1): LavaBlob {
  const baseX = gw * (0.22 + rnd() * 0.56);
  return {
    x: baseX, y: gh * rnd(), r: gw * (0.055 + rnd() * 0.05),
    baseX, phase: (slot / of) * Math.PI * 2 + rnd() * 0.5,
    speed: 0.16 + rnd() * 0.2, sway: gw * (0.04 + rnd() * 0.07),
  };
}

/** Where a blob is `t` seconds in: rising and sinking through most of the lamp, swaying as it goes. */
export function moveLavaBlob(b: LavaBlob, t: number, gh: number): void {
  b.y = gh * 0.5 + gh * 0.42 * Math.sin(t * b.speed + b.phase);
  b.x = b.baseX + b.sway * Math.sin(t * b.speed * 0.7 + b.phase * 1.3);
}

/**
 * The metaball field at a point: each blob contributes r²/d², so wherever
 * the sum reaches 1 is wax. Two blobs nearing each other raise the field
 * between them past 1 before they touch, which is the gooey join a lava lamp
 * is made of.
 */
export function metaballField(x: number, y: number, blobs: readonly LavaBlob[]): number {
  let sum = 0;
  for (const b of blobs) {
    const dx = x - b.x;
    const dy = y - b.y;
    sum += (b.r * b.r) / (dx * dx + dy * dy + 1e-6);
  }
  return sum;
}

/**
 * The pips of a die face, as positions in a unit square (0–1 on each axis),
 * in the order a constellation would join them.
 */
export function diePips(face: number): Array<[number, number]> {
  const L = 0.22, M = 0.5, R = 0.78;
  switch (Math.max(1, Math.min(6, Math.round(face)))) {
    case 1: return [[M, M]];
    case 2: return [[L, L], [R, R]];
    case 3: return [[L, L], [M, M], [R, R]];
    case 4: return [[L, L], [R, L], [R, R], [L, R]];
    case 5: return [[L, L], [R, L], [M, M], [L, R], [R, R]];
    default: return [[L, L], [L, M], [L, R], [R, R], [R, M], [R, L]];
  }
}
