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
    minGapMs: 0,
    maxPerDayGlobal: 100,
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
