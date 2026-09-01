/**
 * Shape validation for the content registry — checks structure, never content
 * (content-specific tests would spoil the pool in CI output).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOMENTS, REGISTRY } from './registry';
import { FACTS } from './content/facts';
import { QUIPS, STREAK_LINES } from './content/quips';
import { TRIVIA } from './content/trivia';
import { SELF_CARE, STORY_BEATS, UNLOCKS } from './content/extras';

describe('registry shape', () => {
  it('ids are unique and weights sane', () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of REGISTRY) {
      // Dynamic weights (the story's pity clock) must be sane at both ends
      // of their input range; fixed weights just have to be positive.
      if (typeof e.weight === 'function') {
        const at = (days: number | null) => (e.weight as (c: unknown) => number)({
          event: 'taskCompleted', completionsToday: 0, lifetimeCompletions: 0,
          streakDays: 0, storyStage: 0, triviaCorrect: 0, triviaTotal: 0,
          unlocks: [], daysSinceStoryBeat: days, now: new Date(), rng: Math.random,
        });
        expect(at(null)).toBeGreaterThan(0);
        expect(at(0)).toBeGreaterThan(0);
        expect(at(365)).toBeGreaterThan(0);
        expect(at(365)).toBeLessThan(1000); // a pity clock, not a takeover
      } else {
        expect(e.weight).toBeGreaterThan(0);
      }
      expect(e.triggers.length).toBeGreaterThan(0);
    }
  });

  it('content pools are sizeable, unique, and bounded in length', () => {
    for (const pool of [FACTS, QUIPS, STREAK_LINES, SELF_CARE, STORY_BEATS]) {
      expect(new Set(pool).size).toBe(pool.length);
      for (const s of pool) expect(s.length).toBeLessThanOrEqual(200);
    }
    expect(FACTS.length).toBeGreaterThanOrEqual(80);
    expect(QUIPS.length).toBeGreaterThanOrEqual(60);
    expect(TRIVIA.length).toBeGreaterThanOrEqual(30);
    expect(SELF_CARE.length).toBeGreaterThanOrEqual(10);
  });

  it('trivia answers are valid indices', () => {
    for (const t of TRIVIA) {
      expect(t.choices.length).toBeGreaterThanOrEqual(2);
      expect(t.answer).toBeGreaterThanOrEqual(0);
      expect(t.answer).toBeLessThan(t.choices.length);
    }
  });

  /*
    The other direction, which the test below cannot see: an unlock DEFINED
    but wired to nothing shows in the discoveries list as ??? forever, and
    nobody finds out until a user asks why they can't earn it. Anything not
    driven by a registry entry must be granted by an explicit flow instead
    (the codes, the trivia milestones, the one-shot feature discoveries).
  */
  it('every moment is actually drawn by something', () => {
    /*
      A moment is just a name until the layer knows what to do with it: an
      unhandled one shows an empty overlay that has to be tapped away, which
      reads as a bug rather than a surprise. The layer draws each either on
      the canvas (a branch keyed by name) or in CSS (an .m-<name> rule), so
      the source must mention every name in one of those two ways.
    */
    const layer = readFileSync(
      new URL('./DelightLayer.svelte', import.meta.url), 'utf8');
    const unhandled = MOMENTS.filter(
      (m) => !layer.includes(`.m-${m}`) && !layer.includes(`moment === '${m}'`));
    expect(unhandled, 'listed but never drawn').toEqual([]);
  });

  it('every defined unlock is actually earnable', () => {
    const DIRECT_GRANTS = new Set([
      'chaos-word', 'clairvoyant', 'clockwork', 'gardener', 'hatchling',
      'konami', 'load-bearing', 'quiz-master', 'quiz-whiz', 'sweeper',
    ]);
    const wired = new Set(
      REGISTRY.filter((r) => r.id.startsWith('unlock-')).map((r) => r.id.slice('unlock-'.length)),
    );
    const orphans = UNLOCKS.map((u) => u.id).filter((id) => !wired.has(id) && !DIRECT_GRANTS.has(id));
    expect(orphans, 'defined but unearnable — wire it or drop it').toEqual([]);
  });

  it('unlock ids are unique and every registry unlock references a real one', () => {
    const ids = UNLOCKS.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of REGISTRY.filter((r) => r.id.startsWith('unlock-'))) {
      const p = e.present({
        event: 'taskCompleted', completionsToday: 0, lifetimeCompletions: 0,
        streakDays: 0, storyStage: 0, triviaCorrect: 0, triviaTotal: 0,
        unlocks: [], daysSinceStoryBeat: null, now: new Date(), rng: Math.random,
      });
      expect(p.kind).toBe('unlock');
      if (p.kind === 'unlock') expect(ids).toContain(p.unlockId);
      // Earned awards must never be gated behind the ambient chance roll.
      expect(e.guaranteed).toBe(true);
    }
  });

  it('story beats advance stages monotonically from 0', () => {
    const stages = REGISTRY.filter((r) => r.id.startsWith('story-')).map((r) => r.exactStoryStage);
    expect(stages).toEqual(stages.map((_, i) => i));
  });
});
