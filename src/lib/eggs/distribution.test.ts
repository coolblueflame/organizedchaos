/**
 * Where does delight actually land? Reported 2026-07-28: browsing the app
 * produced more surprises than finishing tasks, and trivia only ever appeared
 * while navigating. This simulates a realistic day against the REAL registry
 * and asserts the balance, so the answer is measured rather than estimated.
 *
 * The app's whole premise is celebrating work done, so a session must reward
 * completions more than it rewards wandering around.
 */
import { describe, expect, it } from 'vitest';
import { EggEngine, type EggState, type Presentation } from './engine';
import { REGISTRY } from './registry';
import { UNLOCKS } from './content/extras';

/** A day of use: a completion every few minutes, with browsing in between. */
function simulate(opts: { completions: number; navsPerCompletion: number; seed?: number }) {
  let clock = new Date('2026-07-28T09:00:00').getTime();
  let n = opts.seed ?? 1;
  // Deterministic LCG so the numbers are stable across runs.
  const rng = () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };
  // An established user: every one-time award already earned, so what we are
  // measuring is the ONGOING mix rather than a burst of first-time unlocks.
  let saved: EggState | null = {
    seen: {}, trivia: { correct: 0, total: 0 }, unlocks: UNLOCKS.map((u) => u.id),
    storyStage: 99, lastPresentedAt: 0, presentedDay: '', presentedToday: 0,
    lastCompletionDay: '', streakDays: 4,
  };
  const engine = new EggEngine({
    registry: REGISTRY,
    rolloverHour: 4,
    rng,
    now: () => new Date(clock),
    load: async () => saved,
    save: async (s) => { saved = s; },
  });

  const byEvent = { taskCompleted: 0, screenVisited: 0, other: 0 };
  /** Presentation kinds seen, keyed by the event that produced them. */
  const kindsByEvent: Record<string, Record<string, number>> = {
    taskCompleted: {}, screenVisited: {},
  };
  const record = (event: string, p: Presentation | null) => {
    if (!p) return;
    const bucket: keyof typeof byEvent =
      event === 'taskCompleted' || event === 'screenVisited' ? event : 'other';
    byEvent[bucket] += 1;
    const k = kindsByEvent[bucket];
    if (k) k[p.kind] = (k[p.kind] ?? 0) + 1;
  };

  return engine.ready.then(() => {
    for (let i = 0; i < opts.completions; i += 1) {
      for (let j = 0; j < opts.navsPerCompletion; j += 1) {
        clock += 20_000; // twenty seconds of poking around
        record('screenVisited', engine.handle('screenVisited', { screen: 'list' }));
      }
      clock += 40_000;
      record('taskCompleted', engine.handle('taskCompleted', {
        completionsToday: i + 1, lifetimeCompletions: 500 + i,
      }));
    }
    return { byEvent, kindsByEvent };
  });
}

describe('delight distribution over a realistic day', () => {
  it('rewards finishing work more than wandering around', async () => {
    // 12 tasks done, 6 screen visits between each — a browsing-heavy day.
    const { byEvent } = await simulate({ completions: 12, navsPerCompletion: 6 });
    expect(byEvent.taskCompleted).toBeGreaterThan(byEvent.screenVisited);
  });

  it('holds up even for someone who navigates constantly', async () => {
    const { byEvent } = await simulate({ completions: 10, navsPerCompletion: 15, seed: 7 });
    expect(byEvent.taskCompleted).toBeGreaterThan(byEvent.screenVisited);
  });

  it('a burst of completions is not silenced by the quiet-time governor', async () => {
    // Ticking off five things in a couple of minutes should feel like more
    // than one of them counted.
    let clock = new Date('2026-07-28T14:00:00').getTime();
    let saved: EggState | null = null;
    const engine = new EggEngine({
      registry: REGISTRY,
      rolloverHour: 4,
      rng: () => 0.01, // every chance gate passes; only the governor can block
      now: () => new Date(clock),
      load: async () => saved,
      save: async (s) => { saved = s; },
    });
    await engine.ready;
    let shown = 0;
    for (let i = 0; i < 5; i += 1) {
      clock += 25_000; // 25s apart — a brisk but ordinary run through a list
      if (engine.handle('taskCompleted', { completionsToday: i + 1, lifetimeCompletions: 9 })) {
        shown += 1;
      }
    }
    expect(shown).toBeGreaterThanOrEqual(3);
  });

  it('screen visits have more than one possible outcome', () => {
    // Trivia used to be the ONLY entry that could trigger on a screen visit,
    // so every browse-triggered surprise was necessarily a quiz. That is a
    // property of the registry, not of any one sampled day, so assert it there.
    const onBrowse = REGISTRY.filter((e) => e.triggers.includes('screenVisited'));
    expect(onBrowse.length).toBeGreaterThan(1);
    expect(new Set(onBrowse.map((e) => e.id)).size).toBeGreaterThan(1);
  });

  it('browsing stays a rare garnish next to finishing things', async () => {
    // Even for someone who wanders constantly, the app should read as
    // "celebrates work" rather than "celebrates scrolling".
    const { byEvent, kindsByEvent } = await simulate({
      completions: 4, navsPerCompletion: 25, seed: 3,
    });
    console.log('browse-heavy day →', JSON.stringify({ byEvent, kindsByEvent }));
    expect(byEvent.taskCompleted).toBeGreaterThanOrEqual(byEvent.screenVisited * 2);
  });

  it('a ritual-heavy day is not wall-to-wall candles (2026-08-11 report)', async () => {
    // The ritual voice is the ONLY entry on its event; uncapped, six daily
    // rituals meant a candle on most completions — cozy register, noon or
    // not. Capped, it rests and the paired taskCompleted event right behind
    // it supplies the ordinary variety instead.
    let clock = new Date('2026-08-11T09:00:00').getTime();
    let saved: EggState | null = {
      seen: {}, trivia: { correct: 0, total: 0 }, unlocks: UNLOCKS.map((u) => u.id),
      storyStage: 99, lastPresentedAt: 0, presentedDay: '', presentedToday: 0,
      lastCompletionDay: '', streakDays: 4,
    };
    const engine = new EggEngine({
      registry: REGISTRY,
      rolloverHour: 4,
      rng: () => 0.01, // every chance gate passes; only cooldowns/caps block
      now: () => new Date(clock),
      load: async () => saved,
      save: async (s) => { saved = s; },
    });
    await engine.ready;

    let candles = 0;
    let others = 0;
    // Six rituals through the day, each firing its pair like completeRitual does.
    for (let i = 0; i < 6; i += 1) {
      const r = engine.handle('ritualCompleted', { completionsToday: i + 1, lifetimeCompletions: 300 + i });
      clock += 1000;
      const t = engine.handle('taskCompleted', { completionsToday: i + 1, lifetimeCompletions: 300 + i });
      for (const p of [r, t]) {
        if (!p) continue;
        if (p.kind === 'note' && p.emoji === '🕯️') candles += 1;
        else others += 1;
      }
      clock += 90 * 60_000; // ninety minutes to the next ritual
    }
    expect(candles).toBeLessThanOrEqual(2); // the daily cap holds
    expect(others).toBeGreaterThanOrEqual(2); // and the day still has a voice
  });
});
