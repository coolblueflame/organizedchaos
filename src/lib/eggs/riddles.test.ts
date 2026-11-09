import { describe, expect, it } from 'vitest';
import { OPEN_AT_ONCE, RIDDLES, normalizeAnswer, openRiddles, riddleAnsweredBy } from './riddles';
import { TRINKETS } from './den';

const solved = (...ids: string[]) => Object.fromEntries(ids.map((id) => [`riddle:${id}`, 1]));

describe('ENTROPY’s riddles', () => {
  it('each hides a trinket that exists, and no answer is a single letter', () => {
    const ids = RIDDLES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of RIDDLES) {
      expect(TRINKETS.some((t) => t.id === r.reward), r.id).toBe(true);
      for (const a of r.answers) {
        expect(a.length, `${r.id}: ${a}`).toBeGreaterThan(1);
        expect(normalizeAnswer(a), 'answers are stored normalized').toBe(a);
      }
      expect(r.text, 'no em dashes in reader copy').not.toContain('—');
    }
  });

  it('reads a search query the forgiving way', () => {
    expect(normalizeAnswer('  The Dark! ')).toBe('dark');
    expect(normalizeAnswer('a CLOCK')).toBe('clock');
    expect(normalizeAnswer('kevin   the dust-bunny')).toBe('kevin the dust bunny');
  });

  it('opens the first few at once, and one more with every solve', () => {
    expect(openRiddles({}).map((r) => r.id)).toEqual(RIDDLES.slice(0, OPEN_AT_ONCE).map((r) => r.id));
    const afterOne = openRiddles(solved(RIDDLES[1]!.id));
    expect(afterOne).toHaveLength(OPEN_AT_ONCE + 1);
    expect(afterOne.at(-1)!.id).toBe(RIDDLES[OPEN_AT_ONCE]!.id);
  });

  it('is answered only by an open riddle not yet solved', () => {
    expect(riddleAnsweredBy('keyboard', {})!.id).toBe('keys');
    expect(riddleAnsweredBy('keyboard', solved('keys')), 'already solved').toBeNull();
    expect(riddleAnsweredBy('kevin', {}), 'not open yet: an everyday search cannot solve it').toBeNull();
    expect(riddleAnsweredBy('', {})).toBeNull();
    expect(riddleAnsweredBy('keyboard shortcuts', {}), 'the whole query is the answer').toBeNull();
  });
});
