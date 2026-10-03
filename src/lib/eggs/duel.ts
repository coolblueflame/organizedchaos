/**
 * Dice Duel: push-your-luck dice against ENTROPY (the game is Pig).
 *
 * On a turn, roll as often as you dare: every face but 1 adds to the pot; a
 * 1 empties the pot and passes the die. Banking adds the pot to your score
 * and passes the die. First to DUEL_TARGET wins.
 *
 * Pure: every function takes the face rolled rather than rolling it, so the
 * rules can be tested face by face and the e2e can load the dice.
 */

/** The score that wins. Small enough for a game of a minute or two. */
export const DUEL_TARGET = 30;

export type Side = 'you' | 'entropy';

export interface Duel {
  you: number;
  entropy: number;
  turn: Side;
  /** Points rolled this turn, not yet banked. */
  pot: number;
  /** The face on the die; null before the first roll. */
  face: number | null;
  /** What just happened, for the commentary. */
  last: 'start' | 'roll' | 'bust' | 'bank';
  winner: Side | null;
}

/** A fresh game. The reader always rolls first. */
export function newDuel(): Duel {
  return { you: 0, entropy: 0, turn: 'you', pot: 0, face: null, last: 'start', winner: null };
}

const other = (side: Side): Side => (side === 'you' ? 'entropy' : 'you');

/** The side to move rolls `face`. A 1 busts: the pot is lost and the die passes. */
export function rollDie(d: Duel, face: number): Duel {
  if (d.winner) return d;
  if (face === 1) return { ...d, pot: 0, face, last: 'bust', turn: other(d.turn) };
  return { ...d, pot: d.pot + face, face, last: 'roll' };
}

/** The side to move banks its pot; reaching the target wins, otherwise the die passes. */
export function bankPot(d: Duel): Duel {
  if (d.winner || d.pot === 0) return d;
  const score = d[d.turn] + d.pot;
  const banked: Duel = { ...d, [d.turn]: score, pot: 0, last: 'bank' };
  if (score >= DUEL_TARGET) return { ...banked, winner: d.turn };
  return { ...banked, turn: other(d.turn) };
}

/**
 * How big a pot ENTROPY is willing to sit on this game, between 6 and 14.
 * Drawn once per game, so some games it is cautious and some it is reckless.
 */
export function entropyNerve(rnd: () => number): number {
  return 6 + Math.floor(rnd() * 9);
}

/**
 * Whether ENTROPY rolls again on its turn. It banks the moment banking wins,
 * and otherwise once the pot reaches its nerve, unless the reader is one
 * good turn from winning, when caution stops paying and it plays for the
 * whole thing.
 */
export function entropyRollsAgain(d: Duel, nerve: number): boolean {
  if (d.entropy + d.pot >= DUEL_TARGET) return false;
  if (d.you >= DUEL_TARGET - 8) return true;
  return d.pot < nerve;
}
