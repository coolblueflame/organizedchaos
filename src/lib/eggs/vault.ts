/**
 * SPOILER ZONE: Kevin's vault, the room behind the little door. The door is
 * a pencil doodle in the margin of ENTROPY's notebook, drawn once the first
 * riddle (the one that hides the little key) is solved. It opens only while
 * the companion is holding that key. Inside: Kevin, who is very still, and
 * his collection of lost things, which grows by one for each week the vault
 * is visited. Everything is a ledger mark, so it syncs.
 */
import { addDaysKey } from '../domain/time';
import { riddleSolved } from './riddles';
import type { Outfit } from './den';

/** Ledger keys the vault reads and writes (see DelightProgress.marks). */
export const VAULT_MARKS = {
  /** The little door was opened. */
  opened: 'vault:opened',
  /** Kevin moved, once, in front of someone. */
  kevinMoved: 'kevin:moved',
} as const;

/** Prefix of a week the vault was visited in: `vault:week:<Monday's day key>`. */
export const VAULT_WEEK_PREFIX = 'vault:week:';

/** The riddle whose prize is the key that fits the door (see ./riddles). */
export const KEY_RIDDLE = 'keys';

/** The trinket the door wants held (see ./den TRINKETS). */
export const KEY_TRINKET = 'key';

/** How many taps on Kevin, in one visit, before he moves. */
export const KEVIN_PATIENCE = 10;

/** One lost thing in Kevin's collection. */
export interface Find { emoji: string; label: string }

/**
 * Kevin's collection, in the order things turn up. The first ones are there
 * when the door first opens (the story mentions them); each later week the
 * vault is visited adds the next.
 */
export const KEVIN_FINDS: readonly Find[] = [
  { emoji: '🧵', label: 'one thread' },
  { emoji: '🍪', label: 'a crumb (vintage)' },
  { emoji: '🔘', label: 'a button from a coat nobody owns' },
  { emoji: '📎', label: 'a paperclip, slightly bent, with a story' },
  { emoji: '🧦', label: 'one sock. the other one is a mystery' },
  { emoji: '🪶', label: 'a feather (no bird was harmed, Kevin checked)' },
  { emoji: '🪨', label: 'a very good pebble' },
  { emoji: '🎟️', label: 'half a ticket to something' },
  { emoji: '🗝️', label: 'a key that opens nothing (yet)' },
  { emoji: '🔮', label: 'a marble with a galaxy in it' },
  { emoji: '🌰', label: 'an acorn, for later' },
  { emoji: '🖍️', label: 'a crayon, the colour of dusk' },
  { emoji: '🪙', label: 'a coin from nowhere in particular' },
  { emoji: '🧩', label: 'a puzzle piece from a different puzzle' },
];

/** How many finds are there the day the door first opens. */
export const FINDS_AT_OPENING = 2;

/** The Monday of the week an app-day falls in, as a day key. */
export function weekOf(dayKey: string): string {
  const [y, m, d] = dayKey.split('-').map(Number);
  // Noon keeps the weekday right whatever the clocks did that day.
  const dow = new Date(y!, m! - 1, d!, 12).getDay();
  return addDaysKey(dayKey, -((dow + 6) % 7));
}

/** Whether the doodle is in the notebook's margin: the key's riddle is solved. */
export function doorDrawn(marks: Readonly<Record<string, number>>): boolean {
  return riddleSolved(marks, KEY_RIDDLE);
}

/** Whether the little door has been opened. */
export function vaultOpened(marks: Readonly<Record<string, number>>): boolean {
  return marks[VAULT_MARKS.opened] !== undefined;
}

/** Whether the companion is holding the key, which is what the door wants. */
export function holdingKey(fit: Outfit): boolean {
  return fit.held?.id === KEY_TRINKET;
}

/** How many different weeks the vault has been visited in. */
export function weeksVisited(marks: Readonly<Record<string, number>>): number {
  return Object.keys(marks).filter((k) => k.startsWith(VAULT_WEEK_PREFIX)).length;
}

/**
 * The finds on Kevin's shelf: the opening ones, then one more for every
 * visited week after the first, up to the whole collection. Nothing before
 * the door is opened.
 */
export function vaultFinds(marks: Readonly<Record<string, number>>): readonly Find[] {
  if (!vaultOpened(marks)) return [];
  const extra = Math.max(0, weeksVisited(marks) - 1);
  return KEVIN_FINDS.slice(0, Math.min(KEVIN_FINDS.length, FINDS_AT_OPENING + extra));
}

/** Whether Kevin's collection is complete. */
export function collectionComplete(marks: Readonly<Record<string, number>>): boolean {
  return vaultFinds(marks).length === KEVIN_FINDS.length;
}

/**
 * What Kevin "says" to each tap, in order, until he moves. He says nothing;
 * these are the room describing him.
 */
export const KEVIN_STILL: readonly string[] = [
  'Kevin is very still.',
  'Kevin remains very still.',
  'Kevin is being still on purpose now.',
  'a single strand of Kevin’s fluff stirs. it was the air.',
  'Kevin is still. stiller than before, somehow.',
  'ENTROPY whispers: "he can do this all day."',
  'Kevin has not blinked. Kevin may not have eyes.',
  'the companion is holding its breath too.',
  'something is building. Kevin is very, very still.',
];

/** What happens when Kevin finally moves. */
export const KEVIN_MOVES = 'Kevin MOVED. one tiny hop, then perfectly still again, as if nothing happened. ENTROPY fell off its chair.';

/** What Kevin's moving looks like after the first time, on later taps. */
export const KEVIN_AFTER: readonly string[] = [
  'Kevin is very still. you both know what you saw.',
  'Kevin is still. there is a smugness to it now.',
  'Kevin refuses to comment on the incident.',
  'Kevin is guarding the vault. very still. very brave.',
];
