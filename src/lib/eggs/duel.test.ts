import { describe, expect, it } from 'vitest';
import { DUEL_TARGET, bankPot, entropyNerve, entropyRollsAgain, newDuel, rollDie, type Duel } from './duel';

describe('dice duel rules', () => {
  it('adds every face but 1 to the pot, and the reader rolls first', () => {
    let d = newDuel();
    expect(d.turn).toBe('you');
    d = rollDie(d, 4);
    d = rollDie(d, 6);
    expect(d.pot).toBe(10);
    expect(d.turn).toBe('you');
    expect(d.face).toBe(6);
  });

  it('a 1 empties the pot and passes the die without touching the score', () => {
    let d: Duel = { ...newDuel(), you: 12 };
    d = rollDie(d, 5);
    d = rollDie(d, 1);
    expect(d).toMatchObject({ you: 12, pot: 0, turn: 'entropy', last: 'bust', face: 1 });
  });

  it('banking scores the pot and passes the die', () => {
    let d = rollDie(newDuel(), 5);
    d = bankPot(d);
    expect(d).toMatchObject({ you: 5, pot: 0, turn: 'entropy', last: 'bank', winner: null });
  });

  it('an empty pot cannot be banked', () => {
    const d = newDuel();
    expect(bankPot(d)).toBe(d);
  });

  it('reaching the target wins, and a finished game ignores further moves', () => {
    let d: Duel = { ...newDuel(), you: DUEL_TARGET - 4 };
    d = bankPot(rollDie(d, 4));
    expect(d.winner).toBe('you');
    expect(d.turn, 'the winner keeps the die; there is no next turn').toBe('you');
    expect(rollDie(d, 6)).toBe(d);
    expect(bankPot(d)).toBe(d);
  });
});

describe('ENTROPY at the table', () => {
  it('draws a nerve between 6 and 14', () => {
    expect(entropyNerve(() => 0)).toBe(6);
    expect(entropyNerve(() => 0.9999)).toBe(14);
  });

  it('always rolls at the start of its turn', () => {
    const d: Duel = { ...newDuel(), turn: 'entropy' };
    expect(entropyRollsAgain(d, 6)).toBe(true);
  });

  it('banks once the pot reaches its nerve', () => {
    const d: Duel = { ...newDuel(), turn: 'entropy', pot: 10 };
    expect(entropyRollsAgain(d, 10)).toBe(false);
    expect(entropyRollsAgain(d, 11)).toBe(true);
  });

  it('banks the moment banking wins, however bold it feels', () => {
    const d: Duel = { ...newDuel(), turn: 'entropy', entropy: 26, pot: 4, you: 29 };
    expect(entropyRollsAgain(d, 14)).toBe(false);
  });

  it('plays for the whole thing when the reader is one good turn from winning', () => {
    const d: Duel = { ...newDuel(), turn: 'entropy', entropy: 5, pot: 12, you: DUEL_TARGET - 8 };
    expect(entropyRollsAgain(d, 6)).toBe(true);
  });
});
