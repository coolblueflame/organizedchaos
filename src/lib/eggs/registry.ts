/**
 * The delight registry: content pools wired into engine entries. Weights and
 * cooldowns are the tuning surface — content lives in ./content/ (spoiler zone).
 */
import type { EggDef } from './engine';
import { pickFresh } from './freshPick';
import { FACTS } from './content/facts';
import {
  BULK_LINES, CHECKLIST_LINES, NIGHT_NOTES, QUEUE_LINES, QUIPS, RITUAL_LINES, STREAK_LINES,
  SWEEP_LINES, TIMEBOX_LINES, TIPS, UNBLOCK_LINES, WORK_PERIOD_LINES,
} from './content/quips';
import { TRIVIA } from './content/trivia';
import { STORY_BEATS, UNLOCKS } from './content/extras';

/**
 * Content is DEALT, not rolled: every line in a pool is used once before any
 * repeats (see freshPick). Each pool passes its own key so the bags stay
 * independent. Moments keep the plain roll — seeing a good one again is the
 * point of them, and there are few enough that a cycle would be a schedule.
 */
const deal = <T>(key: string, arr: readonly T[], rng: () => number): T => pickFresh(key, arr, rng);
const pick = <T>(arr: readonly T[], rng: () => number): T => arr[Math.floor(rng() * arr.length)]!;

const HOUR = 3600_000;

export const MOMENTS = [
  'rainbow-wave', 'matrix-rain', 'crt-flicker', 'confetti-storm',
  'disco', 'starfield', 'invert-blip', 'friendly-bsod', 'aurora',
  'fireworks', 'bubbles', 'ticker-tape', 'sunrise',
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

/*
  Nothing here fires on screenVisited (2026-09-02 ask: "reserve them for
  completing tasks — it feels odd when they pop up randomly"). Delight is
  payment for finishing something, not a toll on walking around the app.
  The exceptions are deliberate and not navigation: a visual moment on the
  big button or on opening the app, and the story, which is allowed to greet
  you at the door.
*/
export const REGISTRY: EggDef[] = [
  // The bread and butter: facts + quips on completions.
  {
    id: 'fact', weight: 50, triggers: ['taskCompleted'],
    present: (c) => ({ kind: 'note', emoji: '💡', text: deal('facts', FACTS, c.rng) }),
  },
  {
    id: 'quip', weight: 40, triggers: ['taskCompleted', 'drawAccepted'],
    present: (c) => ({ kind: 'note', emoji: '✨', text: deal('quips', QUIPS, c.rng) }),
  },
  {
    id: 'streak-line', weight: 25, triggers: ['taskCompleted'], minStreak: 3, cooldownMs: 3 * HOUR,
    present: (c) => ({ kind: 'note', emoji: '🔥', text: deal('streak', STREAK_LINES, c.rng), accent: 'orange' }),
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
    present: (c) => ({ kind: 'note', emoji: '⏰', accent: 'orange', text: deal('timebox', TIMEBOX_LINES, c.rng) }),
  },
  {
    id: 'work-period-line', weight: 60, triggers: ['workPeriodStarted'], cooldownMs: HOUR / 2,
    present: (c) => ({ kind: 'note', emoji: '⏱', accent: 'cyan', text: deal('period', WORK_PERIOD_LINES, c.rng) }),
  },
  {
    id: 'bulk-line', weight: 60, triggers: ['bulkActed'], cooldownMs: HOUR / 4,
    present: (c) => ({ kind: 'note', emoji: '💥', accent: 'cyan', text: deal('bulk', BULK_LINES, c.rng) }),
  },
  {
    id: 'unblock-line', weight: 60, triggers: ['taskUnblocked'],
    present: (c) => ({ kind: 'note', emoji: '🗝', accent: 'green', text: deal('unblock', UNBLOCK_LINES, c.rng) }),
  },
  {
    // Cooldown + cap (2026-08-11, "candles at noon"): this is the ONLY voice
    // on its event, so uncapped it dominated a ritual-heavy day — the cozy
    // register read as a wind-down message the clock never asked for. When
    // it sits out, the paired taskCompleted event right behind supplies the
    // ordinary variety instead.
    id: 'ritual-line', weight: 60, triggers: ['ritualCompleted'],
    cooldownMs: 3 * HOUR, maxPerDay: 2,
    present: (c) => ({ kind: 'note', emoji: '🕯️', accent: 'green', text: deal('ritual', RITUAL_LINES, c.rng) }),
  },
  {
    id: 'sweep-line', weight: 60, triggers: ['sweepActed'],
    present: (c) => ({ kind: 'note', emoji: '🧹', accent: 'cyan', text: deal('sweep', SWEEP_LINES, c.rng) }),
  },
  {
    id: 'queue-line', weight: 60, triggers: ['queuePlanned'], cooldownMs: HOUR / 4,
    present: (c) => ({ kind: 'note', emoji: '🃏', accent: 'cyan', text: deal('queue', QUEUE_LINES, c.rng) }),
  },
  {
    id: 'checklist-line', weight: 60, triggers: ['checklistTicked'], cooldownMs: HOUR / 4,
    present: (c) => ({ kind: 'note', emoji: '☑️', accent: 'green', text: deal('checklist', CHECKLIST_LINES, c.rng) }),
  },
  unlockEgg('ritualist', ['ritualCompleted'], () => true),
  unlockEgg('boxer', ['timeboxFinished'], () => true),
  unlockEgg('shepherd', ['taskDragged'], () => true),
  unlockEgg('keymaster', ['taskUnblocked'], () => true),
  unlockEgg('deck-stacker', ['queuePlanned'], () => true),
  unlockEgg('fine-print', ['checklistTicked'], () => true),

  // The evening voice: late hours only, at most once a night-ish. The app
  // dims with the day — a warmer register when a completion lands after dark.
  {
    id: 'night-note', weight: 45, triggers: ['taskCompleted'],
    maxPerDay: 1, cooldownMs: 6 * HOUR,
    condition: (c) => {
      const h = c.now.getHours();
      return h >= 21 || h < 2;
    },
    present: (c) => ({ kind: 'note', emoji: '🌙', accent: 'purple', text: deal('night', NIGHT_NOTES, c.rng) }),
  },
  // Occasionally-useful notes; sparse — unsolicited advice charms in small doses.
  {
    id: 'tip', weight: 14, triggers: ['taskCompleted'],
    cooldownMs: 5 * HOUR, maxPerDay: 2,
    present: (c) => ({ kind: 'note', emoji: '🧭', accent: 'cyan', text: deal('tips', TIPS, c.rng) }),
  },

  /*
    Trivia — persistent score. Raised from 8 to 45 (2026-08-30 ask: "I really
    like them but only see them once every 2-3 days"). The simulation put the
    old rate at ONE quiz per seven days of regular use, which is exactly what
    was reported; 45 lands at about one a day and then plateaus, because the
    2h cooldown and the daily cap take over from the weight. It cannot become
    a quiz app no matter how the other pools drift.

    Dropping the browse trigger (2026-09-02) costs it one of its two event
    streams: about five days in seven rather than seven. Raising the weight
    further buys nothing — completions, not the roll, are the ceiling now —
    so it stays here rather than crowding the facts and quips for no gain.
  */
  {
    id: 'trivia', weight: 45, triggers: ['taskCompleted'],
    cooldownMs: 2 * HOUR, maxPerDay: 3,
    present: (c) => ({ kind: 'trivia', q: deal('trivia', TRIVIA, c.rng) }),
  },
  // Visual moments — rare, loud, short.
  {
    id: 'moment', weight: 6, triggers: ['taskCompleted', 'bigButtonPressed', 'appOpened'],
    cooldownMs: HOUR / 2, maxPerDay: 3,
    present: (c) => ({ kind: 'moment', moment: pick(MOMENTS, c.rng) }),
  },
  // The slow-burn story: one beat per stage, days apart, only for engaged
  // days. Retuned 2026-08-06 (Ben, 12 days / 235 completions / ONE beat),
  // and again 2026-08-19 (two beats total after weeks: beats this small,
  // trickled days apart, lose their thread — "you forget the previous one").
  // Target now: roughly one beat per day of regular use (the day gate below
  // is the ceiling), never more than 2–3 silent days.
  ...STORY_BEATS.map((text, i): EggDef => ({
    id: `story-${i}`,
    // One dominant weight for EVERY stage: the day gate below is the pacing
    // mechanism (one beat per app-day, full stop), so on the first eligible
    // roll of a day the story should simply win — a beat a day is the
    // INTENDED cadence, not the lucky one. The old two-tier version kept a
    // "hook" at headline weight 34, and the sim showed hook beat #3 losing
    // the lottery four days running. A never-seen story counts as hungry.
    weight: (c) => {
      const days = c.daysSinceStoryBeat ?? 2;
      return 120 + Math.min(280, Math.max(0, days - 1) * 160);
    },
    triggers: ['appOpened', 'taskCompleted'],
    exactStoryStage: i,
    // The per-id cooldown cannot space CONSECUTIVE beats (each stage is its
    // own id) — the daysSinceStoryBeat gate below is what keeps two beats a
    // real day apart now that hook weights make back-to-back wins likely.
    cooldownMs: 20 * HOUR,
    maxLifetime: 1,
    condition: (c) => c.lifetimeCompletions >= 3
      && (c.daysSinceStoryBeat === null || c.daysSinceStoryBeat >= 1),
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
  unlockEgg('landslide', ['taskCompleted'], (c) => c.completionsToday >= 50),
  unlockEgg('midnight-oil', ['taskCompleted'], (c) => {
    const h = c.now.getHours();
    return h >= 0 && h < 2;
  }),
  unlockEgg('streak-50', ['taskCompleted'], (c) => c.streakDays >= 50),
  unlockEgg('streak-100', ['taskCompleted'], (c) => c.streakDays >= 100),
  unlockEgg('long-haul', ['taskCompleted'], (c) => c.lifetimeCompletions >= 2500),
  unlockEgg('weekender', ['taskCompleted'], (c) => {
    const d = c.now.getDay();
    return d === 0 || d === 6;
  }),
  // Everything else in UNLOCKS is granted directly by its own flow
  // (grantUnlockAndShow): the codes, the trivia milestones, and the
  // discoveries that read the finished ROW — its age, its tracked time, its
  // list — which the context here deliberately cannot see.
];
