import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PresenterStore } from './presenter.svelte';
import type { Presentation } from './engine';

const unlock = (id: string): Presentation => ({ kind: 'unlock', unlockId: id, label: id });
const note = (text: string): Presentation => ({ kind: 'note', text });

let p: PresenterStore;

beforeEach(() => {
  vi.useFakeTimers();
  p = new PresenterStore();
});
afterEach(() => {
  vi.useRealTimers();
});

/** Past the protected window, so a dismiss actually registers. */
const settle = () => vi.advanceTimersByTime(3100);

describe('PresenterStore', () => {
  it('keeps something readable on screen until it is dismissed', () => {
    // Regression: notes expired on a timer that kept running while the app was
    // BACKGROUNDED, so reopening the app to read one showed an empty screen.
    p.show(note('hello'));
    expect(p.current).toMatchObject({ kind: 'note', text: 'hello' });
    vi.advanceTimersByTime(10 * 60_000);
    expect(p.current).toMatchObject({ kind: 'note', text: 'hello' });
    p.dismiss();
    expect(p.current).toBeNull();
  });

  it('a stray tap elsewhere cannot wipe it before it has been read', () => {
    p.show(note('read me'));
    vi.advanceTimersByTime(200); // a tap already in flight when it appeared
    p.dismissAway();
    expect(p.current).not.toBeNull();
    settle();
    p.dismissAway();
    expect(p.current).toBeNull();
  });

  it('but tapping the thing itself always works, however quickly', () => {
    // Aiming at it is unambiguous — making the user wait would just feel broken.
    p.show(note('tap me'));
    vi.advanceTimersByTime(50);
    p.dismiss();
    expect(p.current).toBeNull();
  });

  it('a full-screen moment still ends by itself, but not before it is readable', () => {
    // It cannot wait forever — a full-screen effect that never leaves blocks
    // the app. But 3.5s was too short for the ones with words in them.
    p.show({ kind: 'moment', moment: 'disco' });
    vi.advanceTimersByTime(5000);
    expect(p.current, 'still up long enough to read').toMatchObject({ kind: 'moment' });
    vi.advanceTimersByTime(4500);
    expect(p.current, 'but it does clear on its own').toBeNull();
  });

  it('and a tap clears a moment immediately once it has settled', () => {
    p.show({ kind: 'moment', moment: 'disco' });
    vi.advanceTimersByTime(3100);
    p.dismiss();
    expect(p.current).toBeNull();
  });

  it('queues awards instead of letting them replace each other', () => {
    p.show(unlock('a'));
    p.show(unlock('b'));
    expect(p.current).toMatchObject({ unlockId: 'a' }); // b waits its turn
    settle();
    p.dismiss();
    vi.advanceTimersByTime(300);
    expect(p.current).toMatchObject({ unlockId: 'b' });
  });

  it('ignores a duplicate award already waiting in the queue', () => {
    p.show(unlock('a'));
    p.show(unlock('b'));
    p.show(unlock('b'));
    settle();
    p.dismiss();
    vi.advanceTimersByTime(300);
    expect(p.current).toMatchObject({ unlockId: 'b' });
    settle();
    p.dismiss();
    vi.advanceTimersByTime(300);
    expect(p.current).toBeNull(); // only the one 'b'
  });

  it('a second dismiss during the hand-off does not skip an award', () => {
    // Regression: the hand-off delay was scheduled on an untracked timer, so a
    // dismiss arriving during it shifted ANOTHER award off the queue and
    // scheduled a second hand-off. Both fired, the first award appeared for a
    // frame and was overwritten — earned, recorded, never actually seen.
    p.show(unlock('a'));
    p.show(unlock('b'));
    p.show(unlock('c'));
    settle();
    p.dismiss();
    p.dismiss(); // arrives inside the hand-off window
    vi.advanceTimersByTime(300);
    expect(p.current).toMatchObject({ unlockId: 'b' });
    settle();
    p.dismiss();
    vi.advanceTimersByTime(300);
    expect(p.current).toMatchObject({ unlockId: 'c' });
  });

  it('ambient content cannot jump in front of an award mid-hand-off', () => {
    p.show(unlock('a'));
    p.show(unlock('b'));
    settle();
    p.dismiss(); // 'b' is on its way in
    p.show(note('ambient'));
    expect(p.current).toBeNull(); // the note did not seize the empty slot
    vi.advanceTimersByTime(300);
    expect(p.current).toMatchObject({ unlockId: 'b' });
  });

  it('ambient content still yields to whatever is already on screen', () => {
    p.show({ kind: 'trivia', q: { q: '?', choices: ['a', 'b'], answer: 0 } });
    p.show(note('nope'));
    expect(p.current).toMatchObject({ kind: 'trivia' });
  });

  it('a waiting award does not hurry the one being read', () => {
    // Awards wait for the reader now, so earning a second one mid-read must
    // not cut the first one short.
    p.show(unlock('a'));
    p.show(unlock('b'));
    vi.advanceTimersByTime(60_000);
    expect(p.current).toMatchObject({ unlockId: 'a' });
  });
});
