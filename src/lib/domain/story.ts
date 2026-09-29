/**
 * The story as far as the reader has acknowledged it, gathered into chapters.
 *
 * Beats land a day or more apart, so one that continues the last reads as a
 * non sequitur once the earlier one has faded (2026-09-29: "it put it back"
 * arrived two days after the beat saying what "it" was). A page to reread
 * them fixes that — as long as it never shows a beat the reader has not been
 * told yet, which is why the cut is the acknowledged count, not the total.
 */

/** One chapter: its heading and the beats in it, in order. */
export interface StoryChapter {
  title: string;
  beats: Array<{ index: number; text: string }>;
}

const NUMBERS = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/**
 * A beat that opens with "chapter <word>." begins a new chapter, so the
 * headings come from the story itself rather than a second list to keep in
 * step. The first chapter has no such beat — the story names it only in
 * hindsight — so it is "chapter one" by position.
 *
 * @param beats the whole story, in order
 * @param acknowledged how many beats the reader has read and dismissed
 * @returns chapters holding beats 0 … acknowledged-1, and nothing after
 */
export function storySoFar(beats: readonly string[], acknowledged: number): StoryChapter[] {
  const upTo = Math.max(0, Math.min(beats.length, Math.floor(acknowledged)));
  const chapters: StoryChapter[] = [];
  for (let index = 0; index < upTo; index++) {
    const text = beats[index]!;
    const opens = /^chapter (\w+)\./i.exec(text);
    if (index === 0 || opens) {
      const title = opens ? `chapter ${opens[1]!.toLowerCase()}` : `chapter ${NUMBERS[chapters.length] ?? chapters.length + 1}`;
      chapters.push({ title, beats: [] });
    }
    chapters[chapters.length - 1]!.beats.push({ index, text });
  }
  return chapters;
}
