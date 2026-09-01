import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pickFresh, resetBags } from './freshPick';

beforeEach(() => {
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  resetBags();
});

const POOL = ['a', 'b', 'c', 'd', 'e'];

describe('pickFresh', () => {
  it('uses every line before it uses any twice', () => {
    const seen = POOL.map(() => pickFresh('t', POOL, Math.random));
    expect(new Set(seen).size, 'a full cycle with no repeat').toBe(POOL.length);
  });

  it('reshuffles once the bag runs dry, so it never runs out', () => {
    const many = Array.from({ length: POOL.length * 3 }, () => pickFresh('t', POOL, Math.random));
    expect(many).toHaveLength(15);
    // Each complete cycle is itself a full permutation.
    for (let c = 0; c < 3; c += 1) {
      expect(new Set(many.slice(c * 5, c * 5 + 5)).size, `cycle ${c}`).toBe(5);
    }
  });

  it('keeps pools apart — one bag never eats another', () => {
    pickFresh('one', POOL, () => 0);
    pickFresh('one', POOL, () => 0);
    const other = new Set(POOL.map(() => pickFresh('two', POOL, Math.random)));
    expect(other.size, 'the second pool still has its whole cycle').toBe(5);
  });

  it('survives a pool that shrank between releases', () => {
    // Bags hold INDICES, so content edits must never read past the end.
    for (let i = 0; i < 3; i += 1) pickFresh('t', POOL, Math.random);
    const smaller = ['x', 'y'];
    const got = Array.from({ length: 6 }, () => pickFresh('t', smaller, Math.random));
    expect(got.every((g) => smaller.includes(g)), 'only real lines').toBe(true);
  });

  it('a one-line pool is simply that line', () => {
    expect(pickFresh('solo', ['only'], Math.random)).toBe('only');
  });
});
