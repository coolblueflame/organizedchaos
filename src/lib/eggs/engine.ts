/**
 * The delight engine (spec §12). An event bus with a weighted, governed,
 * cooldown-aware picker over a content registry. The engine enforces every
 * hard rule centrally: at most one presentation per event, a global frequency
 * governor, and zero access to user data (the consented transient-draw path
 * lives in the randomizer, not here). Content itself lives in ./content/ and
 * is intentionally undocumented elsewhere.
 */
import { appDayKey } from '../domain/time';

export type EggEvent =
  | 'taskCompleted' | 'drawAccepted' | 'drawSkipped'
  | 'screenVisited' | 'appOpened' | 'bigButtonPressed'
  | 'timeboxFinished' | 'workPeriodStarted' | 'bulkActed' | 'taskDragged';

export interface EggContext {
  event: EggEvent;
  screen?: string;
  completionsToday: number;
  lifetimeCompletions: number;
  streakDays: number;
  storyStage: number;
  triviaCorrect: number;
  triviaTotal: number;
  /** Already-earned unlock ids — lets unlock entries stay eligible until granted. */
  unlocks: string[];
  now: Date;
  rng: () => number;
}

export interface TriviaQ {
  q: string;
  choices: string[];
  answer: number; // index into choices
  reveal?: string;
}

export type Presentation =
  | { kind: 'note'; text: string; emoji?: string; accent?: string }
  | { kind: 'moment'; moment: string }
  | { kind: 'trivia'; q: TriviaQ }
  | { kind: 'unlock'; unlockId: string; label: string }
  | { kind: 'story'; text: string; stage: number };

export interface EggDef {
  id: string;
  /** Relative weight within the eligible set for one roll. */
  weight: number;
  /**
   * Earned, deterministic entries (unlocks): once the condition is true they
   * fire on the very next matching event, skipping the chance roll and the
   * quiet-time governor. A milestone the user has genuinely earned must never
   * be a dice roll — "completed your first task" has to land on the FIRST task.
   * Safe to exempt because each unlock can only ever fire once in a lifetime.
   */
  guaranteed?: boolean;
  triggers: EggEvent[];
  cooldownMs?: number;
  maxPerDay?: number;
  maxLifetime?: number;
  minCompletionsToday?: number;
  minStreak?: number;
  exactStoryStage?: number;
  condition?: (ctx: EggContext) => boolean;
  present: (ctx: EggContext) => Presentation;
}

interface SeenRow { count: number; lastAt: number; day: string; dayCount: number }

export interface EggState {
  seen: Record<string, SeenRow>;
  trivia: { correct: number; total: number };
  unlocks: string[];
  storyStage: number;
  lastPresentedAt: number;
  presentedDay: string;
  presentedToday: number;
  lastCompletionDay: string;
  streakDays: number;
}

/** Factory, not a constant — nested objects must never be shared across instances. */
const freshState = (): EggState => ({
  seen: {}, trivia: { correct: 0, total: 0 }, unlocks: [], storyStage: 0,
  lastPresentedAt: 0, presentedDay: '', presentedToday: 0,
  lastCompletionDay: '', streakDays: 0,
});

export interface EngineDeps {
  registry: EggDef[];
  rolloverHour: number;
  rng?: () => number;
  now?: () => Date;
  load: () => Promise<EggState | null>;
  save: (s: EggState) => Promise<void>;
  /** Probability that an event produces a presentation at all, per event type. */
  baseChance?: Partial<Record<EggEvent, number>>;
  /** Global governor: minimum quiet time between presentations. */
  minGapMs?: number;
  maxPerDayGlobal?: number;
}

const DEFAULT_CHANCE: Record<EggEvent, number> = {
  taskCompleted: 0.4, drawAccepted: 0.15, drawSkipped: 0.08,
  screenVisited: 0.05, appOpened: 0.12, bigButtonPressed: 0.04,
  timeboxFinished: 0.6, workPeriodStarted: 0.35, bulkActed: 0.3, taskDragged: 0.05,
};

export class EggEngine {
  readonly ready: Promise<void>;
  private state: EggState = freshState();
  private registry: EggDef[];
  private rolloverHour: number;
  private rng: () => number;
  private now: () => Date;
  private saveFn: (s: EggState) => Promise<void>;
  private baseChance: Record<EggEvent, number>;
  private minGapMs: number;
  private maxPerDayGlobal: number;

  constructor(deps: EngineDeps) {
    this.registry = deps.registry;
    this.rolloverHour = deps.rolloverHour;
    this.rng = deps.rng ?? Math.random;
    this.now = deps.now ?? (() => new Date());
    this.saveFn = deps.save;
    this.baseChance = { ...DEFAULT_CHANCE, ...deps.baseChance };
    this.minGapMs = deps.minGapMs ?? 90_000;
    this.maxPerDayGlobal = deps.maxPerDayGlobal ?? 14;
    this.ready = deps.load().then((s) => {
      if (s) {
        this.state = {
          ...freshState(),
          ...s,
          seen: { ...s.seen },
          trivia: { correct: s.trivia?.correct ?? 0, total: s.trivia?.total ?? 0 },
          unlocks: [...(s.unlocks ?? [])],
        };
      }
    });
  }

  get streakDays(): number { return this.state.streakDays; }
  get triviaStats(): { correct: number; total: number } { return { ...this.state.trivia }; }
  get unlocks(): string[] { return [...this.state.unlocks]; }
  get storyStage(): number { return this.state.storyStage; }

  private persist(): void {
    void this.saveFn({ ...this.state });
  }

  private touchStreak(day: string): void {
    if (this.state.lastCompletionDay === day) return;
    const yesterday = appDayKey(new Date(this.now().getTime() - 24 * 3600_000), this.rolloverHour);
    this.state.streakDays = this.state.lastCompletionDay === yesterday ? this.state.streakDays + 1 : 1;
    this.state.lastCompletionDay = day;
  }

  /** The one entry point: report an event, maybe get one presentation back. */
  handle(event: EggEvent, partial: Partial<Omit<EggContext, 'event' | 'now' | 'rng'>>): Presentation | null {
    const now = this.now();
    const day = appDayKey(now, this.rolloverHour);
    if (event === 'taskCompleted') this.touchStreak(day);

    const ctx: EggContext = {
      event,
      screen: partial.screen,
      completionsToday: partial.completionsToday ?? 0,
      lifetimeCompletions: partial.lifetimeCompletions ?? 0,
      streakDays: this.state.streakDays,
      storyStage: this.state.storyStage,
      triviaCorrect: this.state.trivia.correct,
      triviaTotal: this.state.trivia.total,
      unlocks: [...this.state.unlocks],
      now,
      rng: this.rng,
    };

    const result = this.pick(ctx, day, now.getTime());
    this.persist(); // streak/day bookkeeping persists even when nothing fires
    return result;
  }

  private pick(ctx: EggContext, day: string, ts: number): Presentation | null {
    const presentedToday = this.state.presentedDay === day ? this.state.presentedToday : 0;

    const eligible = this.registry.filter((egg) => {
      if (!egg.triggers.includes(ctx.event)) return false;
      const seen = this.state.seen[egg.id];
      if (egg.cooldownMs && seen && ts - seen.lastAt < egg.cooldownMs) return false;
      if (egg.maxPerDay && seen && seen.day === day && seen.dayCount >= egg.maxPerDay) return false;
      if (egg.maxLifetime && seen && seen.count >= egg.maxLifetime) return false;
      if (egg.minCompletionsToday && ctx.completionsToday < egg.minCompletionsToday) return false;
      if (egg.minStreak && ctx.streakDays < egg.minStreak) return false;
      if (egg.exactStoryStage !== undefined && ctx.storyStage !== egg.exactStoryStage) return false;
      if (egg.condition && !egg.condition(ctx)) return false;
      return true;
    });
    if (eligible.length === 0) return null;

    // Earned entries jump the queue; everything else answers to the governor,
    // because ambient delight must never become noise (spec §12).
    let pool = eligible.filter((egg) => egg.guaranteed);
    if (pool.length === 0) {
      if (ts - this.state.lastPresentedAt < this.minGapMs) return null;
      if (presentedToday >= this.maxPerDayGlobal) return null;
      if (this.rng() > (this.baseChance[ctx.event] ?? 0)) return null;
      pool = eligible;
    }

    const total = pool.reduce((s, e) => s + e.weight, 0);
    let roll = this.rng() * total;
    let chosen = pool[pool.length - 1]!;
    for (const egg of pool) {
      roll -= egg.weight;
      if (roll <= 0) { chosen = egg; break; }
    }

    const prior = this.state.seen[chosen.id];
    this.state.seen[chosen.id] = {
      count: (prior?.count ?? 0) + 1,
      lastAt: ts,
      day,
      dayCount: prior?.day === day ? (prior.dayCount ?? 0) + 1 : 1,
    };
    this.state.lastPresentedAt = ts;
    this.state.presentedDay = day;
    this.state.presentedToday = presentedToday + 1;
    return chosen.present(ctx);
  }

  recordTrivia(correct: boolean): void {
    this.state.trivia.total += 1;
    if (correct) this.state.trivia.correct += 1;
    this.persist();
  }

  /** True if newly granted; false if already discovered. */
  grantUnlock(id: string): boolean {
    if (this.state.unlocks.includes(id)) return false;
    this.state.unlocks.push(id);
    this.persist();
    return true;
  }

  /** Story only ever moves forward. */
  advanceStory(toStage: number): void {
    if (toStage > this.state.storyStage) {
      this.state.storyStage = toStage;
      this.persist();
    }
  }
}
