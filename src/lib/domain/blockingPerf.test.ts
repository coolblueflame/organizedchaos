/**
 * Liveness guard for the dependency solver. blockLifts runs inside a $derived,
 * so it is recomputed on essentially every task change — an input that makes it
 * pathological freezes the whole app, which spec §12's "never block the user"
 * rule forbids outright.
 *
 * The graph is user-authored and can be tangled by a sync merge (two devices
 * each adding one side of a loop), so "users won't do that" is not a defence.
 */
import { describe, expect, it } from 'vitest';
import { blockLifts } from './blocking';
import { DEFAULT_SETTINGS, type Task } from './types';

const NOW = new Date('2026-07-28T09:00:00');

function mk(id: string, blockedBy: string[], priority: Task['priority'] = 'medium'): Task {
  return {
    id, listId: 'L', name: id, notes: '', priority, tagIds: [],
    inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, blockedBy,
  };
}

describe('blockLifts stays fast on hostile graphs', () => {
  it('handles a fully mutually-blocking group', () => {
    // Every task blocked by every other: one big strongly-connected component,
    // and the shape that made the earlier depth-first solver run for minutes.
    const ids = Array.from({ length: 60 }, (_, i) => `t${i}`);
    const pool = ids.map((id) => mk(id, ids.filter((o) => o !== id)));
    const started = Date.now();
    const lifts = blockLifts(pool, DEFAULT_SETTINGS, NOW);
    expect(Date.now() - started).toBeLessThan(2000);
    // Deadlocked together, so they all settle on the same demand.
    expect(lifts.get('t0')).toBe('medium');
    expect(lifts.size).toBe(ids.length);
  });

  it('propagates along a long chain without quadratic blowup', () => {
    // t0 ← t1 ← … ← t199, with the only urgent task at the far end, so the
    // value has to travel the entire chain.
    const N = 200;
    const pool: Task[] = [];
    for (let i = 0; i < N; i += 1) {
      pool.push(mk(`t${i}`, i === 0 ? [] : [`t${i - 1}`], i === N - 1 ? 'max' : 'someday'));
    }
    const started = Date.now();
    const lifts = blockLifts(pool, DEFAULT_SETTINGS, NOW);
    expect(Date.now() - started).toBeLessThan(2000);
    // Every link in the chain is ultimately holding up the max task.
    expect(lifts.get('t0')).toBe('max');
    expect(lifts.get('t100')).toBe('max');
  });

  it('a wide fan-in of independent blockers is linear', () => {
    const pool: Task[] = [mk('goal', Array.from({ length: 500 }, (_, i) => `b${i}`), 'high')];
    for (let i = 0; i < 500; i += 1) pool.push(mk(`b${i}`, [], 'someday'));
    const started = Date.now();
    const lifts = blockLifts(pool, DEFAULT_SETTINGS, NOW);
    expect(Date.now() - started).toBeLessThan(2000);
    expect(lifts.get('b0')).toBe('high');
    expect(lifts.get('b499')).toBe('high');
  });
});
