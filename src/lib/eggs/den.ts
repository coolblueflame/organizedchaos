/**
 * SPOILER ZONE — the den: the companion's room, reached once a library is
 * big enough to have earned a dragon. What it shows is derived from synced
 * progress (unlocks, the marks ledger); nothing in here fires on its own.
 */
import type { MomentName } from './registry';
import { PET_STAGES } from './content/extras';

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

/** A cosmetic the companion can wear. Purely decorative; earned, never bought. */
export interface Trinket {
  id: string;
  emoji: string;
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
  { id: 'balloon', emoji: '🎈', label: 'a balloon', hint: 'for coming in', earned: () => true },
  { id: 'bow', emoji: '🎀', label: 'a bow', hint: 'keep a flame alive for a week', earned: (p) => p.unlocks.includes('streak-7') },
  { id: 'tophat', emoji: '🎩', label: 'a top hat', hint: 'beat ENTROPY at its own game', earned: (p) => duelWins(p) >= 1 },
  { id: 'shades', emoji: '🕶️', label: 'sunglasses', hint: 'five pages in the scrapbook', earned: (p) => momentsSeen(p.marks) >= 5 },
  { id: 'headphones', emoji: '🎧', label: 'headphones', hint: 'know things', earned: (p) => p.unlocks.includes('quiz-whiz') },
  { id: 'flower', emoji: '🌼', label: 'a flower', hint: 'some things happen every day', earned: (p) => p.unlocks.includes('ritualist') },
  { id: 'lantern', emoji: '🏮', label: 'a lantern', hint: 'the witching hours', earned: (p) => p.unlocks.includes('night-owl') },
  { id: 'wand', emoji: '🪄', label: 'a wand', hint: 'a month of tomorrows', earned: (p) => p.unlocks.includes('streak-30') },
  { id: 'die', emoji: '🎲', label: 'a lucky die', hint: 'win ten duels', earned: (p) => duelWins(p) >= 10 },
  { id: 'star', emoji: '🌟', label: 'a star', hint: 'fill the whole scrapbook', earned: (p) => p.unlocks.includes('seen-it-all') },
];

/**
 * The trinket being worn: whichever `wear:` stamp is newest. Stamps only
 * ever grow, so putting something on is just stamping it now, and two
 * devices that dressed the companion differently agree on the later choice.
 * An unearned or unknown stamp wears nothing rather than something unearned.
 */
export function wornTrinket(p: DenProgress): Trinket | null {
  let newest: [string, number] | null = null;
  for (const [key, at] of Object.entries(p.marks)) {
    if (!key.startsWith(WEAR_PREFIX)) continue;
    if (!newest || at > newest[1]) newest = [key.slice(WEAR_PREFIX.length), at];
  }
  if (!newest) return null;
  const t = TRINKETS.find((x) => x.id === newest![0]);
  return t && t.earned(p) ? t : null;
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
};
