/**
 * Shape validation for the content registry — checks structure, never content
 * (content-specific tests would spoil the pool in CI output).
 */
import { describe, expect, it } from 'vitest';
import { REGISTRY } from './registry';
import { FACTS } from './content/facts';
import { QUIPS, STREAK_LINES } from './content/quips';
import { TRIVIA } from './content/trivia';
import { SELF_CARE, STORY_BEATS, UNLOCKS } from './content/extras';

describe('registry shape', () => {
  it('ids are unique and weights sane', () => {
    const ids = REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of REGISTRY) {
      expect(e.weight).toBeGreaterThan(0);
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

  it('unlock ids are unique and every registry unlock references a real one', () => {
    const ids = UNLOCKS.map((u) => u.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const e of REGISTRY.filter((r) => r.id.startsWith('unlock-'))) {
      const p = e.present({
        event: 'taskCompleted', completionsToday: 0, lifetimeCompletions: 0,
        streakDays: 0, storyStage: 0, triviaCorrect: 0, triviaTotal: 0,
        unlocks: [], now: new Date(), rng: Math.random,
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
