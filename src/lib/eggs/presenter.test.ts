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

describe('PresenterStore', () => {
  it('shows one presentation and clears it after its lifetime', () => {
    p.show(note('hello'));
    expect(p.current).toMatchObject({ kind: 'note', text: 'hello' });
    vi.advanceTimersByTime(7100);
    expect(p.current).toBeNull();
  });

  it('queues awards instead of letting them replace each other', () => {
    p.show(unlock('a'));
    p.show(unlock('b'));
    expect(p.current).toMatchObject({ unlockId: 'a' }); // b waits its turn
    p.dismiss();
    vi.advanceTimersByTime(300);
    expect(p.current).toMatchObject({ unlockId: 'b' });
  });

  it('ignores a duplicate award already waiting in the queue', () => {
    p.show(unlock('a'));
    p.show(unlock('b'));
    p.show(unlock('b'));
    p.dismiss();
    vi.advanceTimersByTime(300);
    expect(p.current).toMatchObject({ unlockId: 'b' });
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
    p.dismiss();
    p.dismiss(); // arrives inside the hand-off window
    vi.advanceTimersByTime(300);
    expect(p.current).toMatchObject({ unlockId: 'b' });
    p.dismiss();
    vi.advanceTimersByTime(300);
    expect(p.current).toMatchObject({ unlockId: 'c' });
  });

  it('ambient content cannot jump in front of an award mid-hand-off', () => {
    p.show(unlock('a'));
    p.show(unlock('b'));
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

  it('awards run shorter while others are waiting, so the run still clears fast', () => {
    p.show(unlock('a'));
    p.show(unlock('b'));
    vi.advanceTimersByTime(2700); // shortened turn, not the full 6s
    expect(p.current).toBeNull();
    vi.advanceTimersByTime(300);
    expect(p.current).toMatchObject({ unlockId: 'b' });
  });
});
