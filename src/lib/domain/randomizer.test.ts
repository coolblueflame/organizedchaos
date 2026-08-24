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

describe('work-period fit', () => {
  it('only offers tasks that fit the time left, except max-priority ones', () => {
    const quick = task({ priority: 'medium', estimateHours: 0.25 });
    const long = task({ priority: 'medium', estimateHours: 3 });
    const urgentLong = task({ priority: 'max', estimateHours: 8 });

    // 20 minutes left: the 3h task is out, the emergency still isn't
    const scope = { maxEstimateHours: 0.34 };
    for (let i = 0; i < 15; i++) {
      const got = drawTask([quick, long, urgentLong], DEFAULT_SETTINGS, now, Math.random, scope)!;
      expect(got.id).toBe(urgentLong.id); // max tier wins outright
    }
    const withoutUrgent = drawTask([quick, long], DEFAULT_SETTINGS, now, Math.random, scope)!;
    expect(withoutUrgent.id).toBe(quick.id);
  });

  it('a missing estimate counts as an hour', () => {
    const unestimated = task({ priority: 'low' });
    expect(drawTask([unestimated], DEFAULT_SETTINGS, now, firstRng, { maxEstimateHours: 0.5 })).toBeNull();
    expect(drawTask([unestimated], DEFAULT_SETTINGS, now, firstRng, { maxEstimateHours: 1 })!.id)
      .toBe(unestimated.id);
  });
});

describe('drawTask — what is owed right now (due rituals)', () => {
  it('a due ritual beats even a max-priority task', () => {
    const urgent = task({ priority: 'max' });
    const lunch = task({ priority: 'medium' });
    const got = drawTask([urgent, lunch], DEFAULT_SETTINGS, now, firstRng, {
      dueFirst: [lunch.id],
    });
    expect(got?.id).toBe(lunch.id);
  });

  it('and beats the day queue — a window closes, a queue does not', () => {
    const planned = task({ priority: 'low' });
    const lunch = task({ priority: 'medium' });
    const got = drawTask([planned, lunch], DEFAULT_SETTINGS, now, firstRng, {
      queueFirst: [planned.id], dueFirst: [lunch.id],
    });
    expect(got?.id).toBe(lunch.id);
  });

  it('several owed tasks still draw among themselves', () => {
    const a = task({ priority: 'medium' });
    const b = task({ priority: 'medium' });
    const other = task({ priority: 'max' });
    const got = drawTask([other, a, b], DEFAULT_SETTINGS, now, firstRng, {
      dueFirst: [a.id, b.id],
    });
    expect([a.id, b.id]).toContain(got?.id);
  });

  it('an owed id absent from the pool changes nothing', () => {
    const normal = task({ priority: 'max' });
    const got = drawTask([normal], DEFAULT_SETTINGS, now, firstRng, {
      dueFirst: ['not-here'],
    });
    expect(got?.id).toBe(normal.id);
  });
});

describe('drawTask — the day queue', () => {
  it('serves the first queued task in the pool, outranking every tier', () => {
    const big = task({ priority: 'max' });
    const planned = task({ priority: 'low' });
    const tasks = [big, planned];
    const got = drawTask(tasks, DEFAULT_SETTINGS, now, firstRng, { queueFirst: [planned.id] });
    expect(got?.id).toBe(planned.id);
  });

  it('queue order is what counts, not priority within the queue', () => {
    const second = task({ priority: 'max' });
    const first = task({ priority: 'someday' });
    const got = drawTask([second, first], DEFAULT_SETTINGS, now, firstRng, {
      queueFirst: [first.id, second.id],
    });
    expect(got?.id).toBe(first.id);
  });

  it('a snoozed or excluded queue top falls through to the next queued task', () => {
    const snoozed = task({ priority: 'high', notTodayUntil: now.getTime() + 60_000 });
    const nextUp = task({ priority: 'low' });
    const got = drawTask([snoozed, nextUp], DEFAULT_SETTINGS, now, firstRng, {
      queueFirst: [snoozed.id, nextUp.id],
    });
    expect(got?.id).toBe(nextUp.id);
  });

  it('work-period fit still gates the queue', () => {
    const tooBig = task({ priority: 'high', estimateHours: 3 });
    const fits = task({ priority: 'low', estimateHours: 0.5 });
    const got = drawTask([tooBig, fits], DEFAULT_SETTINGS, now, firstRng, {
      queueFirst: [tooBig.id, fits.id], maxEstimateHours: 1,
    });
    expect(got?.id).toBe(fits.id);
  });

  it('an empty or fully-ineligible queue falls back to the normal tiered draw', () => {
    const normal = task({ priority: 'max' });
    const gone = task({ priority: 'high', completedAt: 5 });
    const got = drawTask([normal, gone], DEFAULT_SETTINGS, now, firstRng, {
      queueFirst: [gone.id],
    });
    expect(got?.id).toBe(normal.id);
  });
});

describe('drawTask — project pressure finishes what it started', () => {
  const projectMax = new Map([['L1', 'max' as const]]);

  it('a project-lifted tier serves started tasks absolutely first', () => {
    const untouched = task({ priority: 'low' });
    const started = task({ priority: 'low', inProgress: true });
    // firstRng would pick `untouched` from an unfiltered candidate list —
    // the started-first rule must make the choice before the dice do.
    const got = drawTask([untouched, started], DEFAULT_SETTINGS, now, firstRng,
      undefined, projectMax);
    expect(got?.id).toBe(started.id);
  });

  it('several started tasks still draw among themselves', () => {
    const a = task({ priority: 'low', inProgress: true });
    const b = task({ priority: 'low', inProgress: true });
    const cold = task({ priority: 'low' });
    const got = drawTask([cold, a, b], DEFAULT_SETTINGS, now, firstRng,
      undefined, projectMax);
    expect([a.id, b.id]).toContain(got?.id);
  });

  it('intrinsically-urgent work still outranks a lifted started task', () => {
    const lifted = task({ priority: 'low', inProgress: true });
    const urgent = task({ priority: 'max', listId: 'L2' });
    const got = drawTask([lifted, urgent], DEFAULT_SETTINGS, now, firstRng,
      undefined, projectMax);
    expect(got?.id).toBe(urgent.id);
  });

  it('with nothing started, the lifted tier draws normally', () => {
    const a = task({ priority: 'low' });
    const b = task({ priority: 'low' });
    const got = drawTask([a, b], DEFAULT_SETTINGS, now, firstRng, undefined, projectMax);
    expect([a.id, b.id]).toContain(got?.id);
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

  it('favours started work heavily but not absolutely', () => {
    const fresh = task({ priority: 'high' });
    const started = task({ priority: 'high', inProgress: true });
    const pool = [fresh, started];

    // The group roll comes first: under STARTED_FIRST_CHANCE picks from what
    // is already open, at or above it from the untouched pile.
    expect(drawTask(pool, DEFAULT_SETTINGS, now, () => 0.5)!.id).toBe(started.id);
    expect(drawTask(pool, DEFAULT_SETTINGS, now, () => 0.95)!.id).toBe(fresh.id);

    let startedHits = 0;
    for (let i = 0; i < 600; i++) {
      if (drawTask(pool, DEFAULT_SETTINGS, now, Math.random)!.id === started.id) startedHits += 1;
    }
    expect(startedHits).toBeGreaterThan(420); // ≈80% expected, allow slack
    expect(startedHits).toBeLessThan(560);    // but never a hard lock
  });

  it('the promise holds when the untouched pile dwarfs the started one', () => {
    // THE 2026-08-24 measurement: a real tier held 12 started tasks against
    // 824 untouched, where the old per-task 5:1 came to ~7% — the whole
    // reason this became a group-level roll. Population must not dilute it.
    const started = Array.from({ length: 12 }, () => task({ priority: 'high', inProgress: true }));
    const cold = Array.from({ length: 824 }, () => task({ priority: 'high' }));
    const pool = [...cold, ...started];
    const startedIds = new Set(started.map((t) => t.id));

    let hits = 0;
    for (let i = 0; i < 500; i++) {
      if (startedIds.has(drawTask(pool, DEFAULT_SETTINGS, now, Math.random)!.id)) hits += 1;
    }
    expect(hits / 500, 'roughly four draws in five, whatever the ratio').toBeGreaterThan(0.7);
    expect(hits / 500).toBeLessThan(0.9);
  });

  it('a tier of only untouched work still draws every one of them', () => {
    // The group roll must not strand anyone when there is nothing started:
    // no bucket to prefer means an ordinary uniform pick over the tier.
    const pool = [task({ priority: 'high' }), task({ priority: 'high' }), task({ priority: 'high' })];
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(drawTask(pool, DEFAULT_SETTINGS, now, Math.random)!.id);
    expect(seen.size).toBe(3);
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

describe('the pepper roll (chance-mode tasks, 2026-08-20)', () => {
  it('a hit serves the pepper before any tier; a miss falls through WITHOUT it', () => {
    const pepper = task({ priority: 'low' });
    const normal = task({ priority: 'max' });
    const scope = { peppers: [{ taskId: pepper.id, chancePct: 50 }] };
    // rng: first call is the pepper roll. 0.2 → 20 < 50 → hit.
    expect(drawTask([pepper, normal], DEFAULT_SETTINGS, now, () => 0.2, scope)!.id)
      .toBe(pepper.id);
    // 0.9 → 90 ≥ 50 → miss: the MAX tier draws, and the pepper is chance-only
    // — even a rigged rng can never produce it from the tiers.
    expect(drawTask([pepper, normal], DEFAULT_SETTINGS, now, () => 0.9, scope)!.id)
      .toBe(normal.id);
  });

  it('when peppers are all that is left, one is served rather than an empty screen', () => {
    const pepper = task({ priority: 'low' });
    const scope = { peppers: [{ taskId: pepper.id, chancePct: 5 }] };
    expect(drawTask([pepper], DEFAULT_SETTINGS, now, () => 0.99, scope)!.id).toBe(pepper.id);
  });

  it('due rituals and the day queue both outrank the pepper roll', () => {
    const pepper = task({ priority: 'low' });
    const owed = task({ priority: 'low' });
    const queued = task({ priority: 'low' });
    const certain = { peppers: [{ taskId: pepper.id, chancePct: 100 }] };
    expect(drawTask([pepper, owed], DEFAULT_SETTINGS, now, () => 0,
      { ...certain, dueFirst: [owed.id] })!.id, 'a window closes; a chance does not').toBe(owed.id);
    expect(drawTask([pepper, queued], DEFAULT_SETTINGS, now, () => 0,
      { ...certain, queueFirst: [queued.id] })!.id, 'the plan outranks the dice').toBe(queued.id);
  });
});
