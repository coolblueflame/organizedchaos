import { describe, expect, it } from 'vitest';
import { shuffleReveal } from './shuffle';

/** Synchronous scheduler: runs every queued tick immediately. */
const sync = (fn: () => void) => fn();

describe('shuffleReveal', () => {
  it('emits scrambled same-length frames and settles on the final text', () => {
    const frames: Array<{ text: string; done: boolean }> = [];
    shuffleReveal('water plants', (text, done) => frames.push({ text, done }), {
      schedule: sync, rng: () => 0.42,
    });
    expect(frames.length).toBeGreaterThan(2);
    const last = frames[frames.length - 1]!;
    expect(last).toEqual({ text: 'water plants', done: true });
    for (const f of frames.slice(0, -1)) {
      expect(f.done).toBe(false);
      expect(f.text).toHaveLength('water plants'.length);
      expect(f.text[5]).toBe(' '); // spaces stay spaces — keeps the shape readable
    }
  });

  it('empty text settles immediately', () => {
    const frames: boolean[] = [];
    shuffleReveal('', (_t, done) => frames.push(done), { schedule: sync });
    expect(frames).toEqual([true]);
  });
});
