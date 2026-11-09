/**
 * SPOILER ZONE — ENTROPY's riddles: a notebook in the den, answered by
 * typing the answer into the search bar (the story introduces both). The
 * first few are open at once and each solve opens the next, so there is
 * always something to chew on without the whole book at once. A solve is a
 * ledger mark (`riddle:<id>`), so it syncs, and each riddle hides a trinket.
 */

export interface Riddle {
  id: string;
  /** The riddle as ENTROPY wrote it. */
  text: string;
  /** Accepted answers, already normalized (see normalizeAnswer). */
  answers: readonly string[];
  /** The trinket the riddle hides (see den.TRINKETS). */
  reward: string;
}

export const RIDDLE_PREFIX = 'riddle:';

/** How many unsolved riddles the notebook shows at once. */
export const OPEN_AT_ONCE = 3;

export const RIDDLES: readonly Riddle[] = [
  { id: 'keys', reward: 'key', answers: ['keyboard'],
    text: 'I have keys but open no doors. I have space but no room. you can enter, but you can never go inside. what am I?' },
  { id: 'steps', reward: 'cap', answers: ['footsteps', 'footprints', 'steps'],
    text: 'the more of me you take, the more of me you leave behind. what am I?' },
  { id: 'later', reward: 'candle', answers: ['tomorrow'],
    text: 'I am always on my way and never arrive. half of every list is waiting for me. what am I?' },
  { id: 'hands', reward: 'specs', answers: ['clock', 'watch'],
    text: 'I have a face and two hands but no arms. I keep your timeboxes honest, more or less. what am I?' },
  { id: 'mirror', reward: 'butterfly', answers: ['level'],
    text: 'read me forwards or backwards and I am the same. a little 8-bit moment shouts me when you win. what am I?' },
  { id: 'morale', reward: 'kevin', answers: ['kevin', 'kevin the dust bunny'],
    text: 'I live under the stats screen. I am in charge of morale. I am very still. what is my name?' },
  { id: 'shelf', reward: 'moon', answers: ['dark', 'darkness'],
    text: 'the more of me there is, the less you see. the companion was afraid of me under the shelf, once. what am I?' },
  { id: 'last', reward: 'scholar', answers: ['joke', 'jokes'],
    text: 'I can be cracked, made, told and played. ENTROPY tells terrible ones. what am I?' },
];

/**
 * A search query as an answer: lowercase, punctuation dropped, a leading
 * "a", "an" or "the" ignored, spaces collapsed. "The Dark!" answers "dark".
 */
export function normalizeAnswer(query: string): string {
  return query.toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^(a|an|the) /, '');
}

/** Whether a riddle has been solved. */
export function riddleSolved(marks: Readonly<Record<string, number>>, id: string): boolean {
  return marks[`${RIDDLE_PREFIX}${id}`] !== undefined;
}

/**
 * The riddles the notebook shows: every solved one, plus the next unsolved
 * ones in order up to OPEN_AT_ONCE, so a solve always opens one more page.
 */
export function openRiddles(marks: Readonly<Record<string, number>>): Riddle[] {
  const open: Riddle[] = [];
  let unsolved = 0;
  for (const r of RIDDLES) {
    if (riddleSolved(marks, r.id)) open.push(r);
    else if (unsolved < OPEN_AT_ONCE) { open.push(r); unsolved += 1; }
  }
  return open;
}

/**
 * The open, unsolved riddle a search query answers, or null. Only open
 * riddles count, so an everyday search cannot solve a page nobody has seen.
 */
export function riddleAnsweredBy(query: string, marks: Readonly<Record<string, number>>): Riddle | null {
  const answer = normalizeAnswer(query);
  if (answer === '') return null;
  return openRiddles(marks).find((r) => !riddleSolved(marks, r.id) && r.answers.includes(answer)) ?? null;
}
