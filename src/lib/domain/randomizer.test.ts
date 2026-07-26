import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Priority, type Task } from './types';
import { drawTask, eligibleForDraw } from './randomizer';

const now = new Date('2026-07-15T12:00:00');

let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'L1', name: 'task', notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

const firstRng = () => 0; // always picks candidates[0]

describe('eligibleForDraw', () => {
  it('excludes completed, deleted, and snoozed; includes expired snoozes', () => {
    const pool = [
      task({ priority: 'high' }),
      task({ priority: 'high', completedAt: 5 }),
      task({ priority: 'high', deleted: true }),
      task({ priority: 'high', notTodayUntil: now.getTime() + 60_000 }),
      task({ priority: 'high', notTodayUntil: now.getTime() - 60_000 }),
    ];
    const ids = eligibleForDraw(pool, now).map((t) => t.id);
    expect(ids).toEqual([pool[0]!.id, pool[4]!.id]);
  });

  it('scopes to a list when asked', () => {
    const a = task({ priority: 'low', listId: 'A' });
    const b = task({ priority: 'low', listId: 'B' });
    expect(eligibleForDraw([a, b], now, { listId: 'B' })).toEqual([b]);
  });

  it('tag filter matches ANY selected tag; empty filter means no tag restriction', () => {
    const urgent = task({ priority: 'low', tagIds: ['urgent'] });
    const chill = task({ priority: 'low', tagIds: ['chill'] });
    const untagged = task({ priority: 'low' });
    expect(eligibleForDraw([urgent, chill, untagged], now, { tagIds: ['urgent', 'chill'] }))
      .toEqual([urgent, chill]);
    expect(eligibleForDraw([urgent, untagged], now, { tagIds: [] }))
      .toEqual([urgent, untagged]);
  });

  it('excludeIds ("Not Now" session set) removes tasks from the pool', () => {
    const a = task({ priority: 'high' });
    const b = task({ priority: 'high' });
    expect(eligibleForDraw([a, b], now, { excludeIds: [a.id] })).toEqual([b]);
  });
});

describe('drawTask — tier selection', () => {
  it('only draws from the highest non-empty effective tier', () => {
    const med = task({ priority: 'medium' });
    const hi1 = task({ priority: 'high' });
    const hi2 = task({ priority: 'high' });
    for (let i = 0; i < 20; i++) {
      const got = drawTask([med, hi1, hi2], DEFAULT_SETTINGS, now, Math.random);
      expect(got!.priority).toBe('high');
    }
  });

  it('someday is drawable only when nothing above exists', () => {
    const sd = task({ priority: 'someday' });
    expect(drawTask([sd], DEFAULT_SETTINGS, now, firstRng)!.id).toBe(sd.id);
    const lo = task({ priority: 'low' });
    expect(drawTask([sd, lo], DEFAULT_SETTINGS, now, firstRng)!.id).toBe(lo.id);
  });

  it('deadline escalation drives the tier (manual-low overdue beats manual-high)', () => {
    const overdueLow = task({ priority: 'low', deadline: '2026-07-10' });
    const plainHigh = task({ priority: 'high' });
    expect(drawTask([overdueLow, plainHigh], DEFAULT_SETTINGS, now, firstRng)!.id).toBe(overdueLow.id);
  });

  it('prefers in-progress tasks within the tier', () => {
    const fresh = task({ priority: 'high' });
    const started = task({ priority: 'high', inProgress: true });
    for (let i = 0; i < 20; i++) {
      expect(drawTask([fresh, started], DEFAULT_SETTINGS, now, Math.random)!.id).toBe(started.id);
    }
  });

  it('returns null when nothing is eligible', () => {
    expect(drawTask([task({ priority: 'high', completedAt: 1 })], DEFAULT_SETTINGS, now, firstRng)).toBeNull();
  });

  it('"Not Now" exclusion of the whole top tier falls through to the next tier', () => {
    const hi = task({ priority: 'high' });
    const med = task({ priority: 'medium' });
    expect(drawTask([hi, med], DEFAULT_SETTINGS, now, firstRng, { excludeIds: [hi.id] })!.id).toBe(med.id);
  });

  it('reaches every candidate in the tier (seeded sweep)', () => {
    const pool = [task({ priority: 'max' }), task({ priority: 'max' }), task({ priority: 'max' })];
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(drawTask(pool, DEFAULT_SETTINGS, now, () => (i % 3) / 3)!.id);
    expect(seen.size).toBe(3);
  });
});
