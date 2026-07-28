import { describe, expect, it } from 'vitest';
import { blockLifts, isBlocked, newlyUnblocked, openBlockerIds, wouldCycle } from './blocking';
import { drawTask, eligibleForDraw } from './randomizer';
import { DEFAULT_SETTINGS, type Task } from './types';

const NOW = new Date('2026-07-27T12:00:00');

let seq = 0;
function task(over: Partial<Task> = {}): Task {
  seq += 1;
  return {
    id: `t${seq}`, listId: 'L', name: `task ${seq}`, notes: '',
    priority: 'medium', tagIds: [], inProgress: false,
    createdAt: 0, updatedAt: 0,
    ...over,
  } as Task;
}

describe('blocking', () => {
  it('a task is blocked only while a blocker is genuinely outstanding', () => {
    const chore = task({ id: 'chore' });
    const goal = task({ id: 'goal', blockedBy: ['chore'] });
    expect(isBlocked(goal, [chore, goal])).toBe(true);

    const done = { ...chore, completedAt: 1 };
    expect(isBlocked(goal, [done, goal])).toBe(false);

    const dropped = { ...chore, deleted: true };
    expect(isBlocked(goal, [dropped, goal])).toBe(false);

    // A blocker that no longer exists can't hold anything up.
    expect(isBlocked(goal, [goal])).toBe(false);
    expect(openBlockerIds(goal, new Map([['goal', goal]]))).toEqual([]);
  });

  it('lifts a blocker to the priority of the work waiting on it', () => {
    // Ben's example: a Max task waiting on a Medium chore makes the chore Max.
    const chore = task({ id: 'chore', priority: 'medium' });
    const goal = task({ id: 'goal', priority: 'max', blockedBy: ['chore'] });
    const lifts = blockLifts([chore, goal], DEFAULT_SETTINGS, NOW);
    expect(lifts.get('chore')).toBe('max');
    expect(lifts.has('goal')).toBe(false); // nothing waits on the goal
  });

  it('propagates the lift along a chain of blockers', () => {
    const deep = task({ id: 'deep', priority: 'someday' });
    const mid = task({ id: 'mid', priority: 'low', blockedBy: ['deep'] });
    const goal = task({ id: 'goal', priority: 'max', blockedBy: ['mid'] });
    const lifts = blockLifts([deep, mid, goal], DEFAULT_SETTINGS, NOW);
    expect(lifts.get('mid')).toBe('max');
    expect(lifts.get('deep')).toBe('max'); // inherited two hops up
  });

  it('takes the strongest of several waiting tasks, and ignores finished ones', () => {
    const chore = task({ id: 'chore', priority: 'low' });
    const small = task({ id: 'small', priority: 'low', blockedBy: ['chore'] });
    const big = task({ id: 'big', priority: 'high', blockedBy: ['chore'] });
    const doneBig = task({ id: 'doneBig', priority: 'max', blockedBy: ['chore'], completedAt: 1 });
    const lifts = blockLifts([chore, small, big, doneBig], DEFAULT_SETTINGS, NOW);
    expect(lifts.get('chore')).toBe('high'); // not max — that one is already done
  });

  it('a deadline-escalated waiter lifts by its escalated tier, not its manual one', () => {
    const chore = task({ id: 'chore', priority: 'someday' });
    // Due tomorrow with a 2h estimate → escalates to max (spec §4 bands).
    const goal = task({
      id: 'goal', priority: 'low', estimateHours: 2,
      deadline: '2026-07-28', blockedBy: ['chore'],
    });
    expect(blockLifts([chore, goal], DEFAULT_SETTINGS, NOW).get('chore')).toBe('max');
  });

  it('survives a cycle the user built instead of hanging', () => {
    const a = task({ id: 'a', priority: 'high', blockedBy: ['b'] });
    const b = task({ id: 'b', priority: 'low', blockedBy: ['a'] });
    const lifts = blockLifts([a, b], DEFAULT_SETTINGS, NOW);
    // Everything in a deadlock carries the strongest priority trapped in it:
    // b holds up the high task, and a holds up b, which now demands 'high'.
    // (This assertion used to expect 'low' for a, which was the memoisation
    // bug showing through — the answer depended on which node was walked first.)
    expect(lifts.get('b')).toBe('high');
    expect(lifts.get('a')).toBe('high');
    // …and nothing in the cycle is drawable, which is the honest outcome.
    expect(eligibleForDraw([a, b], NOW)).toEqual([]);
  });

  it('a cycle does not understate the lift of a healthy task blocking into it', () => {
    // Regression: results computed while a cycle edge was cut got memoised and
    // then reused for a task reached by a perfectly ordinary path, handing it a
    // lift lower than the work actually waiting on it. The UI blocks cycles,
    // but a sync merge of two devices can still produce one.
    //
    // b ⇄ a is the cycle; x (high) also waits on a; o is outside it, drawable,
    // and blocks b — so o is holding up x's chain and should inherit 'high'.
    const b = task({ id: 'b', priority: 'low', blockedBy: ['a', 'o'] });
    const x = task({ id: 'x', priority: 'high', blockedBy: ['a'] });
    const a = task({ id: 'a', priority: 'low', blockedBy: ['b'] });
    const o = task({ id: 'o', priority: 'someday' });
    // Order matters: it decides which node the walk reaches first, and the bug
    // only shows when the truncated result is cached before the real one.
    const pool = [b, x, a, o];

    expect(eligibleForDraw(pool, NOW).map((t) => t.id)).toEqual(['o']);
    expect(blockLifts(pool, DEFAULT_SETTINGS, NOW).get('o')).toBe('high');
  });

  it('wouldCycle rejects self-blocks and loops, allows plain chains', () => {
    const a = task({ id: 'a' });
    const b = task({ id: 'b', blockedBy: ['a'] });
    const c = task({ id: 'c', blockedBy: ['b'] });
    expect(wouldCycle('a', 'a', [a, b, c])).toBe(true);
    expect(wouldCycle('a', 'c', [a, b, c])).toBe(true); // c already waits on a
    expect(wouldCycle('c', 'a', [a, b, c])).toBe(false); // c waiting on a is fine
  });

  it('newlyUnblocked reports only tasks with nothing else outstanding', () => {
    const one = task({ id: 'one', completedAt: 1 });
    const two = task({ id: 'two' });
    const freed = task({ id: 'freed', blockedBy: ['one'] });
    const stillStuck = task({ id: 'stuck', blockedBy: ['one', 'two'] });
    const names = newlyUnblocked('one', [one, two, freed, stillStuck]).map((t) => t.id);
    expect(names).toEqual(['freed']);
  });
});

describe('the draw honours blocking', () => {
  it('skips a blocked task and offers the blocker instead', () => {
    const chore = task({ id: 'chore', priority: 'medium' });
    const goal = task({ id: 'goal', priority: 'max', blockedBy: ['chore'] });
    const pool = [chore, goal];
    expect(eligibleForDraw(pool, NOW).map((t) => t.id)).toEqual(['chore']);

    const lifts = blockLifts(pool, DEFAULT_SETTINGS, NOW);
    expect(drawTask(pool, DEFAULT_SETTINGS, NOW, () => 0.5, undefined, undefined, lifts)?.id)
      .toBe('chore');
  });

  it('a lifted blocker competes with natively max work rather than yielding to it', () => {
    const chore = task({ id: 'chore', priority: 'medium' });
    const goal = task({ id: 'goal', priority: 'max', blockedBy: ['chore'] });
    const other = task({ id: 'other', priority: 'max' });
    const pool = [chore, goal, other];
    const lifts = blockLifts(pool, DEFAULT_SETTINGS, NOW);

    // Both ends of the rng land on a real candidate, and 'goal' is never one.
    const drawn = new Set(
      [0.01, 0.99].map(
        (r) => drawTask(pool, DEFAULT_SETTINGS, NOW, () => r, undefined, undefined, lifts)?.id,
      ),
    );
    expect(drawn).toEqual(new Set(['chore', 'other']));
  });

  it('without any blockers the draw is unchanged', () => {
    const a = task({ id: 'a', priority: 'high' });
    const b = task({ id: 'b', priority: 'medium' });
    const lifts = blockLifts([a, b], DEFAULT_SETTINGS, NOW);
    expect(lifts.size).toBe(0);
    expect(drawTask([a, b], DEFAULT_SETTINGS, NOW, () => 0.5, undefined, undefined, lifts)?.id)
      .toBe('a');
  });
});

describe('newlyUnblocked is order-independent', () => {
  it('gives the same answer before and after the completion is recorded', () => {
    // The caller needs this BEFORE the write lands, so it can arm its undo
    // entry while the task is still on screen. Same question, same answer,
    // whichever side of the mutation you ask it from.
    const blocker = task({ id: 'blocker' });
    const freed = task({ id: 'freed', blockedBy: ['blocker'] });
    const stuck = task({ id: 'stuck', blockedBy: ['blocker', 'other'] });
    const other = task({ id: 'other' });

    const before = newlyUnblocked('blocker', [blocker, freed, stuck, other]);
    const after = newlyUnblocked('blocker', [
      { ...blocker, completedAt: 1 }, freed, stuck, other,
    ]);
    expect(before.map((t) => t.id)).toEqual(['freed']);
    expect(after.map((t) => t.id)).toEqual(['freed']);
  });
});
