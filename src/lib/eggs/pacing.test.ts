/**
 * Story pacing. Ben's field report (2026-08-06): twelve days of daily use,
 * 235 lifetime completions, ONE story beat — the flat lottery paced the
 * story across most of a year. The retune's contract, pinned here against
 * the REAL registry and the REAL governor (only the dice are seeded):
 *
 *   - a new user catches at least 2 beats in their first week, so they learn
 *     the app has something up its sleeve;
 *   - after the hook, a regular week of use never ends story-silent
 *     (the pity clock);
 *   - beats still never bunch up — the 20h cooldown holds.
 */
import { describe, expect, it } from 'vitest';
import { EggEngine, type EggState } from './engine';
import { REGISTRY } from './registry';

const DAY = 86_400_000;

/**
 * `days` of regular use: a morning open, then `perDay` completions spread
 * through the afternoon with a little browsing between them. Story beats are
 * acknowledged the way the UI does it — advanceStory on presentation.
 */
async function simulate(days: number, seed: number, perDay = 12) {
  let clock = new Date('2026-08-10T09:00:00').getTime();
  let n = seed;
  // Deterministic LCG so the numbers are stable across runs.
  const rng = () => {
    n = (n * 1103515245 + 12345) % 2147483648;
    return n / 2147483648;
  };
  let saved: EggState | null = null;
  const engine = new EggEngine({
    registry: REGISTRY,
    rolloverHour: 4,
    rng,
    now: () => new Date(clock),
    load: async () => saved,
    save: async (s) => { saved = s; },
  });
  await engine.ready;

  let lifetime = 0;
  const beatDays: number[] = [];
  const note = (day: number, p: { kind: string; stage?: number; unlockId?: string } | null) => {
    if (!p) return;
    // Mirror the presenter's bookkeeping, or the sim lies: an ungranted
    // unlock stays guaranteed-eligible and short-circuits every later roll.
    if (p.kind === 'unlock') engine.grantUnlock(p.unlockId!);
    if (p.kind !== 'story') return;
    beatDays.push(day);
    engine.advanceStory(p.stage!); // what the story card does when it shows
  };

  for (let day = 0; day < days; day += 1) {
    const dayStart = new Date('2026-08-10T09:00:00').getTime() + day * DAY;
    clock = dayStart;
    note(day, engine.handle('appOpened', { lifetimeCompletions: lifetime }));
    for (let i = 0; i < perDay; i += 1) {
      clock += 18 * 60_000; // a completion roughly every 18 minutes
      note(day, engine.handle('screenVisited', {
        screen: 'list', completionsToday: i, lifetimeCompletions: lifetime,
      }));
      clock += 2 * 60_000;
      lifetime += 1;
      note(day, engine.handle('taskCompleted', {
        completionsToday: i + 1, lifetimeCompletions: lifetime,
      }));
    }
  }
  return beatDays;
}

describe('story pacing over weeks of regular use', () => {
  it('the first week hooks: at least 2 beats in days 0–6', async () => {
    for (const seed of [1, 7, 42]) {
      const beatDays = await simulate(7, seed);
      expect(beatDays.filter((d) => d < 7).length, `seed ${seed}`)
        .toBeGreaterThanOrEqual(2);
    }
  });

  it('after the hook, no regular week goes story-silent', async () => {
    for (const seed of [1, 7, 42]) {
      const beatDays = await simulate(35, seed);
      // Gap between consecutive beats (and from the last beat to the end)
      // never exceeds a week of regular use.
      let prev = beatDays[0]!;
      expect(beatDays.length).toBeGreaterThanOrEqual(4);
      for (const d of beatDays.slice(1)) {
        expect(d - prev, `seed ${seed}: gap ending day ${d}`).toBeLessThanOrEqual(7);
        prev = d;
      }
      expect(35 - prev, `seed ${seed}: silent tail`).toBeLessThanOrEqual(7);
    }
  });

  it('beats never bunch: the 20h cooldown holds even at hook weights', async () => {
    for (const seed of [1, 7, 42]) {
      const beatDays = await simulate(14, seed);
      // Same-day double beats are impossible: every pair of consecutive
      // beats sits on different sim days.
      for (let i = 1; i < beatDays.length; i += 1) {
        expect(beatDays[i]! - beatDays[i - 1]!, `seed ${seed}`).toBeGreaterThanOrEqual(1);
      }
    }
  });
});
