import { describe, expect, it } from 'vitest';
import { storySoFar } from './story';
import { STORY_BEATS } from '../eggs/content/extras';

const TOY = [
  'the first beat',
  'the second beat',
  'chapter two. the chapter turns',
  'a beat that mentions chapter three in passing',
  'chapter three has no full stop after its number',
  'chapter three. and now it does',
];

describe('storySoFar', () => {
  it('never shows a beat the reader has not acknowledged', () => {
    // The whole point of the cut: rereading is fine, peeking is not.
    for (let read = 0; read <= TOY.length; read++) {
      const shown = storySoFar(TOY, read).flatMap((c) => c.beats.map((b) => b.index));
      expect(shown).toEqual(Array.from({ length: read }, (_, i) => i));
    }
  });

  it('starts a chapter only at a beat that opens with "chapter <word>."', () => {
    const chapters = storySoFar(TOY, TOY.length);
    expect(chapters.map((c) => c.title)).toEqual(['chapter one', 'chapter two', 'chapter three']);
    expect(chapters.map((c) => c.beats.length)).toEqual([2, 3, 1]);
  });

  it('shows no heading for a chapter the reader has not reached', () => {
    expect(storySoFar(TOY, 2).map((c) => c.title)).toEqual(['chapter one']);
  });

  it('has nothing to show before the first beat, and clamps past the end', () => {
    expect(storySoFar(TOY, 0)).toEqual([]);
    expect(storySoFar(TOY, -3)).toEqual([]);
    expect(storySoFar(TOY, 999).flatMap((c) => c.beats)).toHaveLength(TOY.length);
  });

  it('finds the real story\'s chapters, and no false starts', () => {
    // Pins the heading rule against the actual text: a beat that merely
    // talks about a chapter must not open one.
    const titles = storySoFar(STORY_BEATS, STORY_BEATS.length).map((c) => c.title);
    expect(titles[0]).toBe('chapter one');
    expect(new Set(titles).size, 'each heading once').toBe(titles.length);
    const opening = STORY_BEATS.filter((b) => /^chapter \w+\./i.test(b)).length;
    expect(titles).toHaveLength(opening + 1);
  });
});
