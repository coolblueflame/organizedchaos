/**
 * The delight registry: content pools wired into engine entries. Weights and
 * cooldowns are the tuning surface — content lives in ./content/ (spoiler zone).
 */
import type { EggDef } from './engine';
import { FACTS } from './content/facts';
import {
  BULK_LINES, QUIPS, RITUAL_LINES, STREAK_LINES, SWEEP_LINES, TIMEBOX_LINES, UNBLOCK_LINES,
  WORK_PERIOD_LINES,
} from './content/quips';
import { TRIVIA } from './content/trivia';
import { STORY_BEATS, UNLOCKS } from './content/extras';

const pick = <T>(arr: readonly T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)]!;

const HOUR = 3600_000;

export const MOMENTS = [
  'rainbow-wave', 'matrix-rain', 'crt-flicker', 'confetti-storm',
  'disco', 'starfield', 'invert-blip', 'friendly-bsod', 'aurora',
] as const;
export type MomentName = (typeof MOMENTS)[number];

const unlockDef = (id: string) => UNLOCKS.find((u) => u.id === id)!;
const unlockEgg = (
  id: string,
  triggers: EggDef['triggers'],
  condition: NonNullable<EggDef['condition']>,
): EggDef => ({
  id: `unlock-${id}`,
  weight: 1000, // tie-break only: when two are earned at once, both are certain
  guaranteed: true, // earned awards are never a dice roll — see EggDef.guaranteed
  triggers,
  condition: (c) => !c.unlocks.includes(id) && condition(c),
  present: () => ({ kind: 'unlock', unlockId: id, label: unlockDef(id).label }),
});

export const REGISTRY: EggDef[] = [
  // The bread and butter: facts + quips on completions.
  {
    // Also on screenVisited: trivia used to be the ONLY entry that could fire
    // while browsing, so every single browse-triggered surprise was a quiz.
    id: 'fact', weight: 50, triggers: ['taskCompleted', 'screenVisited'],
    present: (c) => ({ kind: 'note', emoji: '💡', text: pick(FACTS, c.rng) }),
  },
  {
    id: 'quip', weight: 40, triggers: ['taskCompleted', 'drawAccepted'],
    present: (c) => ({ kind: 'note', emoji: '✨', text: pick(QUIPS, c.rng) }),
  },
  {
    id: 'streak-line', weight: 25, triggers: ['taskCompleted'], minStreak: 3, cooldownMs: 3 * HOUR,
    present: (c) => ({ kind: 'note', emoji: '🔥', text: pick(STREAK_LINES, c.rng), accent: 'orange' }),
  },
  {
    id: 'grind-note', weight: 30, triggers: ['taskCompleted'], minCompletionsToday: 5, maxPerDay: 1,
    present: (c) => ({
      kind: 'note', emoji: '🏔️', accent: 'cyan',
      text: `${c.completionsToday} tasks today. The mountain is being MOVED.`,
    }),
  },
  // The newer surfaces get their own voices.
  {
    id: 'timebox-line', weight: 60, triggers: ['timeboxFinished'],
    present: (c) => ({ kind: 'note', emoji: '⏰', accent: 'orange', text: pick(TIMEBOX_LINES, c.rng) }),
  },
  {
    id: 'work-period-line', weight: 60, triggers: ['workPeriodStarted'], cooldownMs: HOUR / 2,
    present: (c) => ({ kind: 'note', emoji: '⏱', accent: 'cyan', text: pick(WORK_PERIOD_LINES, c.rng) }),
  },
  {
    id: 'bulk-line', weight: 60, triggers: ['bulkActed'], cooldownMs: HOUR / 4,
    present: (c) => ({ kind: 'note', emoji: '💥', accent: 'cyan', text: pick(BULK_LINES, c.rng) }),
  },
  {
    id: 'unblock-line', weight: 60, triggers: ['taskUnblocked'],
    present: (c) => ({ kind: 'note', emoji: '🗝', accent: 'green', text: pick(UNBLOCK_LINES, c.rng) }),
  },
  {
    id: 'ritual-line', weight: 60, triggers: ['ritualCompleted'],
    present: (c) => ({ kind: 'note', emoji: '🕯️', accent: 'green', text: pick(RITUAL_LINES, c.rng) }),
  },
  {
    id: 'sweep-line', weight: 60, triggers: ['sweepActed'],
    present: (c) => ({ kind: 'note', emoji: '🧹', accent: 'cyan', text: pick(SWEEP_LINES, c.rng) }),
  },
  unlockEgg('ritualist', ['ritualCompleted'], () => true),
  unlockEgg('boxer', ['timeboxFinished'], () => true),
  unlockEgg('shepherd', ['taskDragged'], () => true),
  unlockEgg('keymaster', ['taskUnblocked'], () => true),

  // Trivia — persistent score, sparse by design.
  {
    id: 'trivia', weight: 8, triggers: ['taskCompleted', 'screenVisited'],
    cooldownMs: 2 * HOUR, maxPerDay: 3,
    present: (c) => ({ kind: 'trivia', q: pick(TRIVIA, c.rng) }),
  },
  // Visual moments — rare, loud, short.
  {
    id: 'moment', weight: 6, triggers: ['taskCompleted', 'bigButtonPressed', 'appOpened'],
    cooldownMs: HOUR / 2, maxPerDay: 3,
    present: (c) => ({ kind: 'moment', moment: pick(MOMENTS, c.rng) }),
  },
  // The slow-burn story: one beat per stage, days apart, only for engaged days.
  ...STORY_BEATS.map((text, i): EggDef => ({
    id: `story-${i}`,
    weight: 4,
    triggers: ['appOpened', 'taskCompleted'],
    exactStoryStage: i,
    cooldownMs: 20 * HOUR,
    maxLifetime: 1,
    condition: (c) => c.lifetimeCompletions >= 3,
    present: () => ({ kind: 'story', text, stage: i + 1 }),
  })),
  // Earned discoveries.
  unlockEgg('first-blood', ['taskCompleted'], (c) => c.lifetimeCompletions >= 1),
  unlockEgg('ten-day', ['taskCompleted'], (c) => c.completionsToday >= 10),
  unlockEgg('streak-7', ['taskCompleted'], (c) => c.streakDays >= 7),
  unlockEgg('night-owl', ['taskCompleted'], (c) => {
    const h = c.now.getHours();
    return h >= 2 && h < 4;
  }),
  unlockEgg('century', ['taskCompleted'], (c) => c.lifetimeCompletions >= 100),
  unlockEgg('early-bird', ['taskCompleted'], (c) => {
    // The other end of night-owl's window: after the 4am day rollover,
    // before the ordinary world wakes up.
    const h = c.now.getHours();
    return h >= 4 && h < 7;
  }),
  unlockEgg('streak-30', ['taskCompleted'], (c) => c.streakDays >= 30),
  unlockEgg('half-k', ['taskCompleted'], (c) => c.lifetimeCompletions >= 500),
  unlockEgg('kilotask', ['taskCompleted'], (c) => c.lifetimeCompletions >= 1000),
  unlockEgg('overachiever', ['taskCompleted'], (c) => c.completionsToday >= 20),
  unlockEgg('midnight-oil', ['taskCompleted'], (c) => {
    const h = c.now.getHours();
    return h >= 0 && h < 2;
  }),
  // quiz-whiz, quiz-master, konami, chaos-word, hatchling, sweeper, clairvoyant,
  // gardener and clockwork are granted directly by their own flows (grantUnlockAndShow).
];
