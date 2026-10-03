/**
 * SPOILER ZONE — ENTROPY's sparkles: one small sparkle hidden somewhere in
 * the app each app-day, found by tapping it. The story announced the hobby
 * long before it was real (the beat at SPARKLE_STORY_BEAT), so the hunt
 * starts for a reader once that beat has been read.
 *
 * Where it hides is a pure function of the app-day, so every device agrees
 * on the spot without asking each other; whether it was found travels in
 * the marks ledger as `sparkle:<app-day>`.
 */

/** The story beat in which ENTROPY takes up hiding sparkles. */
export const SPARKLE_STORY_BEAT = 20;

/**
 * Every screen a sparkle can hide on. Screen-level spots only: never inside
 * a list, so a sparkle can never sit in, or point at, a locked list.
 */
export const SPARKLE_SPOTS = [
  'home', 'stats', 'week', 'settings', 'recurring', 'completed', 'tags', 'search',
] as const;

export type SparkleSpot = (typeof SPARKLE_SPOTS)[number];

/** Ledger key prefix for a found sparkle; the rest of the key is its app-day. */
export const SPARKLE_PREFIX = 'sparkle:';

/** FNV-1a: a small, stable string hash, so the same input hashes the same everywhere. */
function hash(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** mulberry32: a tiny seeded generator, so a shuffle replays identically on every device. */
function seeded(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The order the spots are visited in during one block of SPARKLE_SPOTS.length days. */
function blockOrder(block: number): number[] {
  const order = SPARKLE_SPOTS.map((_, i) => i);
  const rnd = seeded(hash(`sparkles:${block}`));
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return order;
}

/**
 * Where the sparkle hides on an app-day (YYYY-MM-DD).
 *
 * Days are taken in blocks as long as the spot list, and each block visits
 * every spot once in its own shuffled order, so no screen repeats inside a
 * block and every screen gets its turn. The only place two days running
 * could share a screen is the seam between blocks; there the new block's
 * first two days trade places. That never moves a block's LAST day, so the
 * fix needs only the previous block's raw order, never a chain of history.
 */
export function sparkleSpot(dayKey: string): SparkleSpot {
  const n = SPARKLE_SPOTS.length;
  const [y, m, d] = dayKey.split('-').map(Number);
  const day = Math.round(Date.UTC(y!, m! - 1, d!) / 86_400_000);
  const block = Math.floor(day / n);
  const order = blockOrder(block);
  if (order[0] === blockOrder(block - 1)[n - 1]) [order[0], order[1]] = [order[1]!, order[0]!];
  return SPARKLE_SPOTS[order[((day % n) + n) % n]!]!;
}

/** How many sparkles have been found, ever. */
export function sparkleTally(marks: Readonly<Record<string, number>>): number {
  return Object.keys(marks).filter((k) => k.startsWith(SPARKLE_PREFIX)).length;
}

/** Whether the sparkle for `dayKey` has been found. */
export function sparkleFound(marks: Readonly<Record<string, number>>, dayKey: string): boolean {
  return marks[`${SPARKLE_PREFIX}${dayKey}`] !== undefined;
}
