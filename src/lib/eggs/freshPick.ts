/**
 * Deal from a shuffled bag instead of rolling a die (2026-08-30 report:
 * "I've started seeing repeats fairly regularly").
 *
 * Independent random picks collide far sooner than intuition suggests: with
 * 150 lines and a hundred-odd draws in a month, repeats are not bad luck,
 * they are the arithmetic. So each pool is dealt without replacement — every
 * line is used once before any is used twice — and the bag reshuffles only
 * when it runs dry. The perceived variety of a pool this size then depends
 * on its real size rather than on collision odds.
 *
 * DEVICE-LOCAL, like the rest of the pacing state: which lines this phone has
 * lately shown says nothing about the user's data, and sharing it would let
 * one device's run of luck silence another's.
 */

const STORAGE_KEY = 'oc-egg-bags';

/** poolKey → the indices still undealt from the current shuffle. */
let bags: Record<string, number[]> | null = null;

function load(): Record<string, number[]> {
  if (bags) return bags;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    bags = raw ? (JSON.parse(raw) as Record<string, number[]>) : {};
  } catch {
    bags = {};
  }
  return bags;
}

function save(): void {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY, JSON.stringify(bags ?? {}));
  } catch { /* storage full or blocked — variety is a nicety, never a requirement */ }
}

/**
 * One item, never repeating until its pool has been exhausted.
 *
 * `key` names the bag, so pools stay independent — and a pool that GROWS
 * (new content ships) simply gets the new indices in its next shuffle
 * rather than needing any migration.
 */
export function pickFresh<T>(key: string, pool: readonly T[], rng: () => number): T {
  if (pool.length === 0) throw new Error(`pickFresh: empty pool ${key}`);
  if (pool.length === 1) return pool[0]!;
  const store = load();
  // Indices from an older, larger shuffle are dropped rather than trusted:
  // content changes between releases and a stale index would read the wrong
  // line or none at all.
  let bag = (store[key] ?? []).filter((i) => i >= 0 && i < pool.length);
  if (bag.length === 0) bag = pool.map((_, i) => i);
  const at = Math.min(Math.floor(rng() * bag.length), bag.length - 1);
  const [index] = bag.splice(at, 1);
  store[key] = bag;
  save();
  return pool[index!]!;
}

/** Test seam: forget every bag. */
export function resetBags(): void {
  bags = {};
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
  } catch { /* nothing to forget */ }
}
