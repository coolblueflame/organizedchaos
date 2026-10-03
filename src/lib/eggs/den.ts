/**
 * SPOILER ZONE — the den: the companion's room, reached once a library is
 * big enough to have earned a dragon. What it shows is derived from synced
 * progress (unlocks, the marks ledger); nothing in here fires on its own.
 */
import type { MomentName } from './registry';
import { PET_STAGES } from './content/extras';
import { sparkleTally } from './sparkles';
import { latestChoice } from './ledger';
import type { Season } from './seasons';
import { SEASON_LOOKS } from './content/seasons';

/** Lifetime completions at which the den opens: the dragon rung of the companion. */
export const DEN_OPENS_AT = 250;

/** Ledger keys the den reads and writes (see DelightProgress.marks). */
export const DEN_MARKS = {
  /** The invitation was opened, or the den was visited without it. */
  invited: 'mail:den',
  /** The welcome card was read. */
  welcomed: 'den:welcomed',
  duelsPlayed: 'duel:played',
  duelsWon: 'duel:wins',
} as const;

/** Prefix of the stamp recorded each time a trinket is put on (`wear:none` takes it off). */
export const WEAR_PREFIX = 'wear:';

/**
 * Whether the den is open: the library is big enough, or it was opened once
 * before. The second half keeps the door from closing on someone whose
 * count drops back below the line after deleting finished tasks.
 */
export function denOpen(lifetime: number, marks: Readonly<Record<string, number>>): boolean {
  return lifetime >= DEN_OPENS_AT || marks[DEN_MARKS.invited] !== undefined;
}

/** The companion's form for a lifetime count — [floor, form, name] — or null before the egg arrives. */
export function companionForm(lifetime: number): readonly [number, string, string] | null {
  let current: readonly [number, string, string] | null = null;
  for (const s of PET_STAGES) if (lifetime >= s[0]) current = s;
  return current;
}

/** What earning a trinket can depend on. */
export interface DenProgress {
  unlocks: readonly string[];
  marks: Readonly<Record<string, number>>;
}

/**
 * Where on the creature something is worn: on its head, over its eyes,
 * over its ears, at its neck, in its hand, or floating just above it.
 */
export type WornSlot = 'head' | 'eyes' | 'ears' | 'neck' | 'held' | 'float';

/** What the companion has on, and where it goes. */
export interface Dressing { emoji: string; slot: WornSlot }

/** A cosmetic the companion can wear. Purely decorative; earned, never bought. */
export interface Trinket {
  id: string;
  emoji: string;
  slot: WornSlot;
  label: string;
  /** Shown in place of the trinket until it is earned. */
  hint: string;
  earned: (p: DenProgress) => boolean;
}

/** How many big moments the scrapbook holds. */
export function momentsSeen(marks: Readonly<Record<string, number>>): number {
  return Object.keys(marks).filter((k) => k.startsWith('moment:')).length;
}

const duelWins = (p: DenProgress) => p.marks[DEN_MARKS.duelsWon] ?? 0;

export const TRINKETS: readonly Trinket[] = [
  { id: 'balloon', emoji: '🎈', slot: 'float', label: 'a balloon', hint: 'for coming in', earned: () => true },
  { id: 'bow', emoji: '🎀', slot: 'head', label: 'a bow', hint: 'keep a flame alive for a week', earned: (p) => p.unlocks.includes('streak-7') },
  { id: 'tophat', emoji: '🎩', slot: 'head', label: 'a top hat', hint: 'beat ENTROPY at its own game', earned: (p) => duelWins(p) >= 1 },
  { id: 'shades', emoji: '🕶️', slot: 'eyes', label: 'sunglasses', hint: 'five pages in the scrapbook', earned: (p) => momentsSeen(p.marks) >= 5 },
  { id: 'headphones', emoji: '🎧', slot: 'ears', label: 'headphones', hint: 'know things', earned: (p) => p.unlocks.includes('quiz-whiz') },
  { id: 'flower', emoji: '🌼', slot: 'head', label: 'a flower', hint: 'some things happen every day', earned: (p) => p.unlocks.includes('ritualist') },
  { id: 'lantern', emoji: '🏮', slot: 'held', label: 'a lantern', hint: 'the witching hours', earned: (p) => p.unlocks.includes('night-owl') },
  { id: 'wand', emoji: '🪄', slot: 'held', label: 'a wand', hint: 'a month of tomorrows', earned: (p) => p.unlocks.includes('streak-30') },
  { id: 'die', emoji: '🎲', slot: 'held', label: 'a lucky die', hint: 'win ten duels', earned: (p) => duelWins(p) >= 10 },
  { id: 'star', emoji: '🌟', slot: 'float', label: 'a star', hint: 'fill the whole scrapbook', earned: (p) => p.unlocks.includes('seen-it-all') },
  { id: 'comet', emoji: '💫', slot: 'float', label: 'a pocket sparkle', hint: 'find ten of ENTROPY’s sparkles', earned: (p) => sparkleTally(p.marks) >= 10 },
];

/**
 * The trinket being worn: the newest `wear:` choice (see ./ledger). An
 * unearned or unknown choice wears nothing rather than something unearned.
 */
export function wornTrinket(p: DenProgress): Trinket | null {
  const id = latestChoice(p.marks, WEAR_PREFIX);
  const t = TRINKETS.find((x) => x.id === id);
  return t && t.earned(p) ? t : null;
}

/**
 * What the companion has on: the reader's choice first, else the season's
 * costume, else nothing.
 */
export function dressing(worn: Trinket | null, season: Season | null): Dressing | null {
  if (worn) return { emoji: worn.emoji, slot: worn.slot };
  if (!season) return null;
  const look = SEASON_LOOKS[season];
  return { emoji: look.costume, slot: look.costumeSlot };
}

/**
 * A companion form split into the creature itself (its last glyph: the
 * dragon in "👑🐲") and whatever the form adds beside it (the crown).
 * Things are worn on the creature, never on the adornment.
 */
export function splitForm(form: string): { adornment: string; creature: string } {
  const glyphs = typeof Intl !== 'undefined' && 'Segmenter' in Intl
    ? Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(form), (s) => s.segment)
    : Array.from(form);
  return { adornment: glyphs.slice(0, -1).join(''), creature: glyphs.at(-1) ?? '' };
}

/** A scrapbook page: the moment's name once seen, a hint until then. */
export interface ScrapbookPage { name: string; hint: string }

/** Typed by MomentName, so a moment added to the registry without a page here fails to compile. */
export const SCRAPBOOK: Readonly<Record<MomentName, ScrapbookPage>> = {
  'rainbow-wave': { name: 'Rainbow Wave', hint: 'the old ways, entered on a keyboard' },
  'matrix-rain': { name: 'Falling Code', hint: 'green, and falling' },
  'crt-flicker': { name: 'Static', hint: 'say the other one’s name' },
  'confetti-storm': { name: 'Confetti Storm', hint: 'over budget, approved' },
  'disco': { name: 'Disco', hint: 'type what this app is called' },
  'starfield': { name: 'Hyperspace', hint: 'punch it' },
  'invert-blip': { name: 'Negative', hint: 'everything, backwards, briefly' },
  'friendly-bsod': { name: 'A Friendly Crash', hint: 'blue, but kind' },
  'aurora': { name: 'Aurora', hint: 'northern skies' },
  'fireworks': { name: 'Fireworks', hint: 'look up' },
  'bubbles': { name: 'Bubbles', hint: 'rising, then gone' },
  'ticker-tape': { name: 'Ticker Tape', hint: 'a parade for one' },
  'sunrise': { name: 'Sunrise', hint: 'dawn, in a hurry' },
  'meteor-shower': { name: 'Meteor Shower', hint: 'make a wish' },
  'petals': { name: 'Petals', hint: 'a spring breeze' },
  'lightning': { name: 'Lightning', hint: 'count the seconds' },
  'lava-lamp': { name: 'Lava Lamp', hint: 'warm, slow, groovy' },
  'card-cascade': { name: 'You Win!', hint: 'a very old card game' },
  'level-clear': { name: 'Level Clear', hint: 'eight bits of victory' },
  'power-off': { name: 'Power Off', hint: 'safe to turn off' },
  'constellation': { name: 'Constellation', hint: 'written in the stars' },
  'fireflies': { name: 'Fireflies', hint: 'a summer dusk' },
  'eyes-in-the-dark': { name: 'Eyes in the Dark', hint: 'only in the dark half of october' },
  'snowfall': { name: 'Snowfall', hint: 'only in december' },
  'balloons': { name: 'Balloons', hint: 'only on a birthday (yours, or the app’s)' },
};
