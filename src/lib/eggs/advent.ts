/**
 * SPOILER ZONE — ENTROPY's winter calendar: twenty-four little doors on the
 * den wall through December. Door N opens from app-day 1 December + (N-1)
 * on; doors left closed can be opened any later day of the calendar, so a
 * busy week loses nothing. Opened doors are ledger marks
 * (`advent:<year>-<n>`), so they sync. Lives only in the winter season.
 */
import type { MomentName } from './registry';

/** How many doors the calendar has. */
export const ADVENT_DOORS = 24;

/** Ledger key for door `n` of the calendar in `year`. */
export const adventKey = (year: number, n: number): string => `advent:${year}-${n}`;

/**
 * How many doors can be opened on an app-day: as many as December days so
 * far (up to the last door), and none outside December.
 */
export function doorsOpenable(dayKey: string): number {
  const [, m, d] = dayKey.split('-').map(Number) as [number, number, number];
  return m === 12 ? Math.min(d, ADVENT_DOORS) : 0;
}

/** Whether door `n` of any year's calendar has been opened (the prizes behind doors 12 and 24 are kept for good). */
export function doorEverOpened(marks: Readonly<Record<string, number>>, n: number): boolean {
  const suffix = `-${n}`;
  return Object.keys(marks).some((k) => k.startsWith('advent:') && k.endsWith(suffix));
}

/** What is behind a door: a few words, sometimes with a moment to watch. */
export interface Gift { text: string; moment?: MomentName }

/** One gift per door, in door order. */
export const GIFTS: readonly Gift[] = [
  { text: 'door one: snow. ENTROPY made it. it is mostly confetti that went cold.', moment: 'snowfall' },
  { text: 'door two: a note from the companion. it says "hello." it is underlined three times.' },
  { text: 'door three: a very small mug of cocoa. ENTROPY already drank it. sorry.' },
  { text: 'door four: the northern lights, borrowed for a minute.', moment: 'aurora' },
  { text: 'door five: Kevin. he does not know how he got in here. he is delighted.' },
  { text: 'door six: one perfectly round snowball. it is for looking at, not throwing.' },
  { text: 'door seven: a tiny wish, folded up. ENTROPY will not say whose.' },
  { text: 'door eight: a sky full of stars, rearranged slightly.', moment: 'constellation' },
  { text: 'door nine: a sock. one sock. ENTROPY says the other one is behind a different door. it is not.' },
  { text: 'door ten: a coupon for one guilt-free nap. no expiry date.' },
  { text: 'door eleven: fireflies, out of season and very confused about it.', moment: 'fireflies' },
  { text: 'door twelve: the middle of the calendar. ENTROPY left something on the shelf to mark it.' },
  { text: 'door thirteen: the sound of the dice rolling, saved in a jar. you cannot hear it. it is there.' },
  { text: 'door fourteen: a list with one item on it: "rest." it is already ticked.' },
  { text: 'door fifteen: a lava lamp, for warmth.', moment: 'lava-lamp' },
  { text: 'door sixteen: the companion, again. it climbed in to see what the doors are like. they are cozy.' },
  { text: 'door seventeen: a paper crown. it is not as good as the real one. it is trying its best.' },
  { text: 'door eighteen: a shooting star. ENTROPY says make a wish quick.', moment: 'meteor-shower' },
  { text: 'door nineteen: a warm scarf for the dice. they get cold sitting in the den.' },
  { text: 'door twenty: a tip for the sparkle hunt, from ENTROPY: it never hides one inside a list. look near the headings.' },
  { text: 'door twenty-one: the longest night of the year. ENTROPY lit a lantern for it.' },
  { text: 'door twenty-two: a snow globe with the den inside. if you shake it, the companion waves.' },
  { text: 'door twenty-three: fireworks, a little early. ENTROPY could not wait.', moment: 'fireworks' },
  { text: 'door twenty-four: the last door. inside: everyone, warm, glad you came by. there is something on the shelf. 💜' },
];
