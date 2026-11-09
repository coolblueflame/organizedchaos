/**
 * SPOILER ZONE — the den: the companion's room, reached once a library is
 * big enough to have earned a dragon. What it shows is derived from synced
 * progress (unlocks, the marks ledger); nothing in here fires on its own.
 */
import type { MomentName } from './registry';
import { PET_STAGES } from './content/extras';
import { sparkleTally } from './sparkles';
import { latestChoiceAt } from './ledger';
import { seasonStartDay, type Season } from './seasons';
import { SEASON_LOOKS } from './content/seasons';
import { appDayKey } from '../domain/time';
import { RIDDLE_PREFIX } from './riddles';
import { doorEverOpened } from './advent';

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

/**
 * Prefix of a choice for one spot on the companion: `wear:<spot>:<id>`, with
 * `none` for wearing nothing there (see ./ledger for how choices are kept).
 */
export const wearPrefix = (slot: WornSlot): string => `wear:${slot}:`;

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
  /** Lifetime completions (the crown is earned by the count, like the form that shows it). */
  lifetime: number;
}

/**
 * Where on the creature something is worn: on its head, over its eyes,
 * over its ears, at its neck, in its hand, or floating just above it.
 */
export type WornSlot = 'head' | 'eyes' | 'ears' | 'neck' | 'held' | 'float';

/** Every spot, in the order the shelf lists them. One thing can be worn in each. */
export const SLOTS: readonly WornSlot[] = ['head', 'eyes', 'ears', 'neck', 'held', 'float'];

/** What the shelf calls each spot's kind of thing. */
export const SLOT_NAMES: Readonly<Record<WornSlot, string>> = {
  head: 'hats', eyes: 'glasses', ears: 'ears', neck: 'scarves', held: 'in paw', float: 'floating',
};

/** Something being worn: which thing, and where. */
export interface Dressing { id: string; emoji: string; slot: WornSlot }

/** Everything being worn, at most one thing per spot. */
export type Outfit = Partial<Record<WornSlot, Dressing>>;

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
/** Whether one of ENTROPY's riddles has been solved (see ./riddles). */
const riddle = (id: string) => (p: DenProgress) => p.marks[`${RIDDLE_PREFIX}${id}`] !== undefined;
/** What a locked riddle prize says it takes. */
const NOTEBOOK_HINT = 'a riddle in ENTROPY’s notebook';

/** The crown's rung on the companion's ladder. */
const CROWN_AT = PET_STAGES[PET_STAGES.length - 1]![0];

export const TRINKETS: readonly Trinket[] = [
  { id: 'crown', emoji: '👑', slot: 'head', label: 'the crown', hint: 'four digits of done', earned: (p) => p.lifetime >= CROWN_AT },
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
  // The prizes behind ENTROPY's riddles (see ./riddles).
  { id: 'key', emoji: '🔑', slot: 'held', label: 'a little key', hint: NOTEBOOK_HINT, earned: riddle('keys') },
  { id: 'cap', emoji: '🧢', slot: 'head', label: 'a cap', hint: NOTEBOOK_HINT, earned: riddle('steps') },
  { id: 'candle', emoji: '🕯️', slot: 'held', label: 'a candle', hint: NOTEBOOK_HINT, earned: riddle('later') },
  { id: 'specs', emoji: '👓', slot: 'eyes', label: 'reading glasses', hint: NOTEBOOK_HINT, earned: riddle('hands') },
  { id: 'butterfly', emoji: '🦋', slot: 'float', label: 'a butterfly', hint: NOTEBOOK_HINT, earned: riddle('mirror') },
  { id: 'kevin', emoji: '🐇', slot: 'float', label: 'Kevin (he insisted)', hint: NOTEBOOK_HINT, earned: riddle('morale') },
  { id: 'moon', emoji: '🌙', slot: 'float', label: 'a little moon', hint: NOTEBOOK_HINT, earned: riddle('shelf') },
  // Behind doors of ENTROPY's winter calendar (see ./advent), kept for good once found.
  { id: 'snowflake', emoji: '❄️', slot: 'float', label: 'a snowflake that never melts', hint: 'the middle of a winter calendar', earned: (p) => doorEverOpened(p.marks, 12) },
  { id: 'tree', emoji: '🎄', slot: 'held', label: 'a very small tree', hint: 'the last door of a winter calendar', earned: (p) => doorEverOpened(p.marks, 24) },
  { id: 'scholar', emoji: '🎓', slot: 'head', label: 'a scholar’s cap', hint: 'the last page of ENTROPY’s notebook', earned: riddle('last') },
];

/** The id a season's costume goes by when it is chosen on the shelf. */
export const costumeId = (season: Season): string => `season-${season}`;

/** A season's costume as something to wear. */
export function costume(season: Season): Dressing {
  const look = SEASON_LOOKS[season];
  return { id: costumeId(season), emoji: look.costume, slot: look.costumeSlot };
}

/**
 * The newest choice from before each spot had its own (`wear:<id>`, one
 * thing worn in all), read as a choice for that thing's spot. Its "none"
 * meant nothing extra over the crown, so it chooses nothing at all now.
 */
function legacyChoice(marks: Readonly<Record<string, number>>): { slot: WornSlot; option: string; at: number } | null {
  let newest: { option: string; at: number } | null = null;
  for (const [key, at] of Object.entries(marks)) {
    const m = key.match(/^wear:([^:]+)$/);
    if (m && (!newest || at > newest.at)) newest = { option: m[1]!, at };
  }
  const t = newest && TRINKETS.find((x) => x.id === newest!.option);
  return t ? { slot: t.slot, option: newest!.option, at: newest!.at } : null;
}

/**
 * Everything the companion has on: per spot, the reader's newest choice
 * (see ./ledger), else what that spot wears by default (the crown, once
 * earned). A season's costume is put on in its spot when the season starts,
 * over anything chosen before then; a choice made since, including taking
 * it off, wins. An unearned or unknown choice wears nothing in that spot
 * rather than something unearned.
 *
 * @param today The app-day it is, for telling choices made this season from older ones.
 */
export function outfit(p: DenProgress, season: Season | null, today: string, rolloverHour: number): Outfit {
  const out: Outfit = {};
  const legacy = legacyChoice(p.marks);
  for (const slot of SLOTS) {
    const choice = latestChoiceAt(p.marks, wearPrefix(slot)) ?? (legacy?.slot === slot ? legacy : null);
    const seasonal = season && SEASON_LOOKS[season].costumeSlot === slot ? costume(season) : null;
    if (seasonal) {
      const chosenThisSeason = choice !== null
        && appDayKey(new Date(choice.at), rolloverHour) >= seasonStartDay(season!, today);
      if (!chosenThisSeason || choice!.option === seasonal.id) { out[slot] = seasonal; continue; }
    }
    const id = choice ? choice.option : slot === 'head' ? 'crown' : null;
    const t = TRINKETS.find((x) => x.id === id && x.slot === slot);
    if (t && t.earned(p)) out[slot] = { id: t.id, emoji: t.emoji, slot };
  }
  return out;
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

/**
 * Adornments of a form that are really things to wear: drawn from the
 * outfit, where they can be swapped for something else, never from the form.
 */
export const WEARABLE_ADORNMENTS: ReadonlySet<string> = new Set(['👑']);

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
  'countdown': { name: 'Countdown', hint: 'only as one year turns into the next' },
};
