import { describe, expect, it } from 'vitest';
import { nextPhrase, PHRASES } from './phrases';

describe('PHRASES', () => {
  it('has a big pool of unique, button-sized phrases', () => {
    expect(PHRASES.length).toBeGreaterThanOrEqual(60);
    expect(new Set(PHRASES).size).toBe(PHRASES.length);
    for (const p of PHRASES) expect(p.length).toBeLessThanOrEqual(32);
  });
});

describe('nextPhrase', () => {
  it('never repeats back-to-back across many draws', () => {
    let prev = nextPhrase();
    for (let i = 0; i < 200; i++) {
      const cur = nextPhrase();
      expect(cur).not.toBe(prev);
      prev = cur;
    }
  });
});
