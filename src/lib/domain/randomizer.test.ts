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

  it('include-list scoping: "all minus omitted" and single-list both work', () => {
    const a = task({ priority: 'low', listId: 'A' });
    const b = task({ priority: 'low', listId: 'B' });
    const c = task({ priority: 'low', listId: 'C' });
    expect(eligibleForDraw([a, b, c], now, { listIds: ['A', 'C'] })).toEqual([a, c]); // B omitted
    expect(eligibleForDraw([a, b, c], now, { listIds: ['B'] })).toEqual([b]);        // scoped entry
    expect(eligibleForDraw([a, b, c], now, { listIds: [] })).toEqual([]);            // everything omitted
    expect(eligibleForDraw([a, b, c], now, {})).toEqual([a, b, c]);                  // no restriction
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

  it('weights in-progress tasks heavily but not absolutely', () => {
    const fresh = task({ priority: 'high' });
    const started = task({ priority: 'high', inProgress: true });
    const pool = [fresh, started];

    // Weights are 1 (fresh) then 5 (started) over a total of 6: a roll below
    // 1/6 lands on the fresh task, anything above it on the started one.
    expect(drawTask(pool, DEFAULT_SETTINGS, now, () => 0.05)!.id).toBe(fresh.id);
    expect(drawTask(pool, DEFAULT_SETTINGS, now, () => 0.5)!.id).toBe(started.id);

    // Over many uniform draws the started task should dominate ~5:1.
    let startedHits = 0;
    for (let i = 0; i < 600; i++) {
      if (drawTask(pool, DEFAULT_SETTINGS, now, Math.random)!.id === started.id) startedHits += 1;
    }
    expect(startedHits).toBeGreaterThan(420); // ≈83% expected, allow slack
    expect(startedHits).toBeLessThan(600);    // but never a hard lock
  });

  it('priority still beats in-progress across tiers', () => {
    const startedHigh = task({ priority: 'high', inProgress: true });
    const freshMax = task({ priority: 'max' });
    for (let i = 0; i < 20; i++) {
      expect(drawTask([startedHigh, freshMax], DEFAULT_SETTINGS, now, Math.random)!.id).toBe(freshMax.id);
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
    // Mid-bucket seeds (equal weights, total 3): 0.1→first, 0.5→second, 0.9→third.
    const seen = new Set<string>();
    const seeds = [0.1, 0.5, 0.9];
    for (let i = 0; i < 30; i++) seen.add(drawTask(pool, DEFAULT_SETTINGS, now, () => seeds[i % 3]!)!.id);
    expect(seen.size).toBe(3);
  });
});
