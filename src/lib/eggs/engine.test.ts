import { beforeEach, describe, expect, it } from 'vitest';
import { EggEngine, type EggDef, type EggState } from './engine';

/** Test registry — placeholder content only; real content lives in content/. */
const REG: EggDef[] = [
  { id: 'common-a', weight: 10, triggers: ['taskCompleted'], present: () => ({ kind: 'note', text: 'A' }) },
  { id: 'common-b', weight: 10, triggers: ['taskCompleted'], present: () => ({ kind: 'note', text: 'B' }) },
  { id: 'rare-c', weight: 1, triggers: ['taskCompleted'], cooldownMs: 60_000, present: () => ({ kind: 'note', text: 'C' }) },
  { id: 'daily-once', weight: 100, triggers: ['taskCompleted'], maxPerDay: 1, present: () => ({ kind: 'note', text: 'D' }) },
  { id: 'screen-only', weight: 5, triggers: ['screenVisited'], condition: (c) => c.screen === 'stats', present: () => ({ kind: 'note', text: 'S' }) },
  { id: 'grind-gate', weight: 5, triggers: ['taskCompleted'], minCompletionsToday: 5, present: () => ({ kind: 'note', text: 'G' }) },
];

let saved: EggState | null = null;
let clock: number;

function makeEngine(rngValues: number[], registry = REG) {
  let i = 0;
  const rng = () => rngValues[Math.min(i++, rngValues.length - 1)]!;
  clock = new Date('2026-07-15T12:00:00').getTime();
  return new EggEngine({
    registry,
    rolloverHour: 4,
    rng,
    now: () => new Date(clock),
    load: async () => saved,
    save: async (s) => { saved = s; },
    baseChance: { taskCompleted: 1, screenVisited: 1, appOpened: 1, drawAccepted: 1, drawSkipped: 1, bigButtonPressed: 1 },
    // These tests are about per-entry cooldowns and caps, so the whole global
    // governor is switched off — including the per-event gaps and ceilings,
    // which have their own coverage in distribution.test.ts.
    minGapMs: 0,
    eventGapMs: {},
    maxPerDayGlobal: 100,
    maxPerDayByEvent: {},
  });
}

beforeEach(() => { saved = null; });

describe('EggEngine', () => {
  it('presents only entries whose trigger and condition match', async () => {
    const e = makeEngine([0.0, 0.0]);
    await e.ready;
    const onStats = e.handle('screenVisited', { screen: 'stats' });
    expect(onStats?.kind).toBe('note');
    const onHome = e.handle('screenVisited', { screen: 'home' });
    expect(onHome).toBeNull();
  });

  it('weighted pick is deterministic under injected rng and records seen state', async () => {
    const e = makeEngine([0.0, 0.999]); // roll 1: chance gate; roll 2: pick near end of weights
    await e.ready;
    const p = e.handle('taskCompleted', {});
    expect(p).not.toBeNull();
    expect(Object.keys(saved!.seen).length).toBe(1);
  });

  it('baseChance gate can suppress a presentation', async () => {
    const e = makeEngine([0.99]); // gate fails when chance < roll
    (e as unknown as { baseChance: Record<string, number> }).baseChance = { taskCompleted: 0.3 } as never;
    await e.ready;
    expect(e.handle('taskCompleted', {})).toBeNull();
  });

  it('cooldown and maxPerDay block repeats; day resets at the 4am rollover', async () => {
    // Pairs of [chance gate, weighted roll]; 0.5 lands in daily-once's span
    // (cumulative weights a10, b20, c21, daily121 → 0.5×121 = 60.5).
    const e = makeEngine([0, 0.5, 0, 0.5, 0, 0.5]);
    await e.ready;
    expect(e.handle('taskCompleted', {})?.kind).toBe('note');
    expect(saved!.seen['daily-once']!.count).toBe(1);
    const second = e.handle('taskCompleted', {});
    expect(second).not.toBeNull(); // daily-once capped → another entry serves
    expect(saved!.seen['daily-once']!.count).toBe(1);
    clock += 24 * 3600_000; // next app-day → cap resets
    e.handle('taskCompleted', {});
    expect(saved!.seen['daily-once']!.count).toBe(2);
  });

  it('global governor enforces min gap and daily cap', async () => {
    const e = makeEngine([0, 0, 0, 0]);
    (e as unknown as { minGapMs: number }).minGapMs = 60_000 as never;
    await e.ready;
    expect(e.handle('taskCompleted', {})).not.toBeNull();
    expect(e.handle('taskCompleted', {})).toBeNull(); // inside the gap
    clock += 61_000;
    expect(e.handle('taskCompleted', {})).not.toBeNull();
  });

  it('minCompletionsToday gates grind entries', async () => {
    const only = REG.filter((r) => r.id === 'grind-gate');
    const e = makeEngine([0, 0], only);
    await e.ready;
    expect(e.handle('taskCompleted', { completionsToday: 2 })).toBeNull();
    expect(e.handle('taskCompleted', { completionsToday: 6 })).not.toBeNull();
  });

  it('an unlock presentation carries an id the caller can record', async () => {
    // Regression: awards were shown but never granted, so they never appeared
    // in the discoveries list and could fire again.
    const registry: EggDef[] = [{
      id: 'award', weight: 1, triggers: ['taskCompleted'],
      present: () => ({ kind: 'unlock', unlockId: 'first-blood', label: 'First!' }),
    }];
    const e = makeEngine([0, 0], registry);
    await e.ready;
    const p = e.handle('taskCompleted', {});
    expect(p).toMatchObject({ kind: 'unlock', unlockId: 'first-blood' });
    expect(e.grantUnlock('first-blood')).toBe(true);
    expect(e.unlocks).toContain('first-blood');
    expect(e.grantUnlock('first-blood')).toBe(false); // second time is a no-op
  });

  it('an earned unlock fires on the FIRST qualifying event, chance gate and governor notwithstanding', async () => {
    // Regression (reported 2026-07-26): "completed your first task" arrived on
    // the user's THIRD completion, because awards rode the same 40% roll and
    // 90s quiet-time governor as ambient quips. Earned ≠ random.
    const registry: EggDef[] = [{
      id: 'unlock-first', weight: 1000, guaranteed: true, triggers: ['taskCompleted'],
      condition: (c) => c.lifetimeCompletions >= 1,
      present: () => ({ kind: 'unlock', unlockId: 'first-blood', label: 'First!' }),
    }];
    const e = makeEngine([0.99, 0.99], registry); // any chance roll would fail
    (e as unknown as { baseChance: Record<string, number> }).baseChance = { taskCompleted: 0.01 } as never;
    (e as unknown as { minGapMs: number }).minGapMs = 3600_000 as never;
    await e.ready;
    expect(e.handle('taskCompleted', { lifetimeCompletions: 1 }))
      .toMatchObject({ kind: 'unlock', unlockId: 'first-blood' });
  });

  it('a guaranteed entry still respects its own condition', async () => {
    const registry: EggDef[] = [{
      id: 'unlock-century', weight: 1000, guaranteed: true, triggers: ['taskCompleted'],
      condition: (c) => c.lifetimeCompletions >= 100,
      present: () => ({ kind: 'unlock', unlockId: 'century', label: '100' }),
    }];
    const e = makeEngine([0, 0], registry);
    await e.ready;
    expect(e.handle('taskCompleted', { lifetimeCompletions: 99 })).toBeNull();
    expect(e.handle('taskCompleted', { lifetimeCompletions: 100 })).not.toBeNull();
  });

  it('trivia stats, unlocks (idempotent), and story stage persist', async () => {
    const e = makeEngine([0]);
    await e.ready;
    e.recordTrivia(true);
    e.recordTrivia(false);
    expect(saved!.trivia).toEqual({ correct: 1, total: 2 });
    expect(e.grantUnlock('u1')).toBe(true);
    expect(e.grantUnlock('u1')).toBe(false);
    expect(saved!.unlocks).toEqual(['u1']);
    e.advanceStory(2);
    e.advanceStory(1); // never regresses
    expect(saved!.storyStage).toBe(2);
  });

  it('streak counts consecutive completion days and resets after a gap', async () => {
    const e = makeEngine([0.99, 0.99, 0.99]); // suppress presentations; streak still tracks
    (e as unknown as { baseChance: Record<string, number> }).baseChance = { taskCompleted: 0.5 } as never;
    await e.ready;
    e.handle('taskCompleted', {});
    expect(e.streakDays).toBe(1);
    clock += 24 * 3600_000;
    e.handle('taskCompleted', {});
    expect(e.streakDays).toBe(2);
    clock += 3 * 24 * 3600_000; // missed days
    e.handle('taskCompleted', {});
    expect(e.streakDays).toBe(1);
  });
});

describe('absorbing progress from another device', () => {
  it('unions discoveries rather than replacing them', async () => {
    // The property that matters: a device that has not heard of an unlock must
    // never be able to take it away from one that earned it.
    const e = makeEngine([0.99]);
    await e.ready;
    e.grantUnlock('mine');
    const changed = e.absorb({
      unlocks: ['theirs'], storyStage: 0, triviaCorrect: 0, triviaTotal: 0,
      streakDays: 0, lastCompletionDay: '',
    });
    expect(changed).toBe(true);
    expect(e.unlocks).toEqual(['mine', 'theirs']);
  });

  it('takes the best of story and trivia, never the worst', async () => {
    const e = makeEngine([0.99]);
    await e.ready;
    e.advanceStory(4);
    e.recordTrivia(true);
    e.recordTrivia(true);
    e.absorb({
      unlocks: [], storyStage: 1, triviaCorrect: 0, triviaTotal: 0,
      streakDays: 0, lastCompletionDay: '',
    });
    expect(e.storyStage, 'a device further behind cannot rewind the story').toBe(4);
    expect(e.triviaStats).toEqual({ correct: 2, total: 2 });
  });

  it('the streak follows whichever device completed something more recently', async () => {
    const e = makeEngine([0.99]);
    await e.ready;
    e.absorb({
      unlocks: [], storyStage: 0, triviaCorrect: 0, triviaTotal: 0,
      streakDays: 3, lastCompletionDay: '2026-07-20',
    });
    expect(e.streakDays).toBe(3);
    // An older report loses even though its number is bigger.
    e.absorb({
      unlocks: [], storyStage: 0, triviaCorrect: 0, triviaTotal: 0,
      streakDays: 99, lastCompletionDay: '2026-07-10',
    });
    expect(e.streakDays).toBe(3);
    // A newer one wins even though its number is smaller.
    e.absorb({
      unlocks: [], storyStage: 0, triviaCorrect: 0, triviaTotal: 0,
      streakDays: 1, lastCompletionDay: '2026-07-25',
    });
    expect(e.streakDays).toBe(1);
  });

  it('reports no change when there is nothing new, so quiet syncs stay quiet', async () => {
    const e = makeEngine([0.99]);
    await e.ready;
    e.grantUnlock('a');
    expect(e.absorb({
      unlocks: ['a'], storyStage: 0, triviaCorrect: 0, triviaTotal: 0,
      streakDays: 0, lastCompletionDay: '',
    })).toBe(false);
  });

  it('leaves this device\'s pacing alone', async () => {
    const e = makeEngine([0, 0.5]);
    await e.ready;
    e.handle('taskCompleted', {}); // records a `seen` entry and the quiet clock
    const pacingBefore = JSON.stringify(saved!.seen);
    e.absorb({
      unlocks: ['x'], storyStage: 2, triviaCorrect: 1, triviaTotal: 1,
      streakDays: 5, lastCompletionDay: '2026-07-25',
    });
    expect(JSON.stringify(saved!.seen), 'pacing is per-device').toBe(pacingBefore);
  });
});
