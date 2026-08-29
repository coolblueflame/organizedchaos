/**
 * The delight engine (spec §12). An event bus with a weighted, governed,
 * cooldown-aware picker over a content registry. The engine enforces every
 * hard rule centrally: at most one presentation per event, a global frequency
 * governor, and zero access to user data (the consented transient-draw path
 * lives in the randomizer, not here). Content itself lives in ./content/ and
 * is intentionally undocumented elsewhere.
 */
import { appDayKey, daysUntilDeadline } from '../domain/time';
import { resolveHeldUnlocks } from '../sync/files';

export type EggEvent =
  | 'taskCompleted' | 'drawAccepted' | 'drawSkipped'
  | 'screenVisited' | 'appOpened' | 'bigButtonPressed'
  | 'timeboxFinished' | 'workPeriodStarted' | 'bulkActed' | 'taskDragged'
  | 'taskUnblocked' | 'ritualCompleted' | 'sweepActed'
  | 'queuePlanned' | 'checklistTicked';

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
  /**
   * Whole days since the last story beat was shown on this device, or null
   * before the first one. Feeds the story's pity clock: the longer the story
   * has been silent, the harder its next beat leans on the lottery.
   */
  daysSinceStoryBeat: number | null;
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
  /**
   * Relative weight within the eligible set for one roll. A function makes
   * it context-dependent — the story's pity clock is the reason this exists
   * (a fixed weight either spams early users or starves patient ones).
   */
  weight: number | ((ctx: EggContext) => number);
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
  /** Per-event presentation counts for the current app-day (see ambient caps). */
  presentedTodayBy?: Record<string, number>;
  trivia: { correct: number; total: number };
  unlocks: string[];
  storyStage: number;
  lastPresentedAt: number;
  presentedDay: string;
  presentedToday: number;
  lastCompletionDay: string;
  streakDays: number;
  /** High-water mark of the streak — the record survives the streak breaking. */
  bestStreakDays?: number;
  /**
   * A story beat that has been SHOWN but not yet acknowledged, as its index.
   *
   * Beats are finite, ordered and once-only, so "shown" is not good enough:
   * an app backgrounded or reloaded before the reader taps OK would burn one
   * forever (2026-08-29 report — a beat vanished mid-read and could never
   * return). This survives with the rest of the delight state, and the app
   * re-presents it on the next open until it is genuinely acknowledged.
   */
  pendingStory?: number;
  /**
   * Per-unlock ownership clocks (see DelightProgress.unlockGrants): newest of
   * grant vs revoke wins, a clock-less held unlock counts as granted at 0.
   * They exist so a wrongly-granted discovery can be taken back without the
   * union merge restoring it from every other device.
   */
  unlockGrants?: Record<string, number>;
  unlockRevokes?: Record<string, number>;
}

/** Factory, not a constant — nested objects must never be shared across instances. */
const freshState = (): EggState => ({
  seen: {}, presentedTodayBy: {}, trivia: { correct: 0, total: 0 }, unlocks: [], storyStage: 0,
  lastPresentedAt: 0, presentedDay: '', presentedToday: 0,
  lastCompletionDay: '', streakDays: 0, bestStreakDays: 0,
  unlockGrants: {}, unlockRevokes: {},
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
  /** Per-event overrides of that quiet time (see EVENT_GAP). */
  eventGapMs?: Partial<Record<EggEvent, number>>;
  maxPerDayGlobal?: number;
  /** Per-event daily ceilings, so ambient events can't eat the whole budget. */
  maxPerDayByEvent?: Partial<Record<EggEvent, number>>;
}

const DEFAULT_CHANCE: Record<EggEvent, number> = {
  taskCompleted: 0.4, drawAccepted: 0.15, drawSkipped: 0.08,
  screenVisited: 0.05, appOpened: 0.12, bigButtonPressed: 0.04,
  timeboxFinished: 0.6, workPeriodStarted: 0.35, bulkActed: 0.3, taskDragged: 0.05,
  taskUnblocked: 0.55, ritualCompleted: 0.5,
  // Sweeping is rapid-fire by design; keep its voice rare or it becomes noise.
  sweepActed: 0.05,
  queuePlanned: 0.25,
  // Checklist ticks come in bursts (packing lists); mostly stay quiet.
  checklistTicked: 0.1,
};

/**
 * Quiet time is not one number, because not every event deserves the same
 * patience. Reported 2026-07-28: browsing the app produced more surprises than
 * finishing tasks did. Two causes — screen visits vastly outnumber completions,
 * so even a low per-event chance wins on volume, and both were competing for
 * the same single governed slot, so wandering around actively stole moments
 * from the work.
 *
 * Finishing something is the whole point of the app, so completions wait only
 * briefly; ambient events (wandering, opening the app) wait much longer and
 * are capped per day on top. Anything not listed falls back to minGapMs.
 */
const EVENT_GAP: Partial<Record<EggEvent, number>> = {
  taskCompleted: 20_000,
  sweepActed: 90_000,
  ritualCompleted: 20_000,
  taskUnblocked: 20_000,
  timeboxFinished: 20_000,
  screenVisited: 300_000,
  appOpened: 300_000,
  // Burst-prone planning actions: one voice per burst is plenty.
  queuePlanned: 120_000,
  checklistTicked: 120_000,
};

/** Ambient events get a hard daily ceiling well under the global one. */
const EVENT_DAILY_CAP: Partial<Record<EggEvent, number>> = {
  screenVisited: 4,
  appOpened: 2,
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
  private eventGapMs: Partial<Record<EggEvent, number>>;
  private maxPerDayGlobal: number;
  private maxPerDayByEvent: Partial<Record<EggEvent, number>>;

  constructor(deps: EngineDeps) {
    this.registry = deps.registry;
    this.rolloverHour = deps.rolloverHour;
    this.rng = deps.rng ?? Math.random;
    this.now = deps.now ?? (() => new Date());
    this.saveFn = deps.save;
    this.baseChance = { ...DEFAULT_CHANCE, ...deps.baseChance };
    this.minGapMs = deps.minGapMs ?? 90_000;
    this.eventGapMs = deps.eventGapMs ?? EVENT_GAP;
    this.maxPerDayGlobal = deps.maxPerDayGlobal ?? 14;
    this.maxPerDayByEvent = deps.maxPerDayByEvent ?? EVENT_DAILY_CAP;
    this.ready = deps.load().then((s) => {
      if (s) {
        this.state = {
          ...freshState(),
          ...s,
          seen: { ...s.seen },
          trivia: { correct: s.trivia?.correct ?? 0, total: s.trivia?.total ?? 0 },
          unlockGrants: { ...s.unlockGrants },
          unlockRevokes: { ...s.unlockRevokes },
          // Re-resolve rather than trust the stored array, so a persisted
          // revocation stays applied no matter what wrote the blob last.
          unlocks: resolveHeldUnlocks(s.unlocks ?? [], s.unlockGrants, s.unlockRevokes),
        };
        this.healStoryStage();
      }
    });
  }

  /**
   * Walk the stage past beats that were already SHOWN.
   *
   * Repair for libraries stalled by the advance-on-close bug (fixed
   * 2026-08-22 in DelightLayer): a beat dismissed by tapping away recorded
   * itself as seen without moving the stage, and since each beat is gated on
   * the stage before it and fires once per lifetime, the arc could never
   * resume — the next beat waits for a stage that will never arrive.
   *
   * Self-verifying, so it can never skip unread content: it only steps over
   * ids the `seen` map proves were presented, and stops at the first that
   * wasn't. Runs at load, costs one map lookup per healed beat.
   */
  private healStoryStage(): void {
    while (this.state.seen[`story-${this.state.storyStage}`]) {
      // Stop at a beat that was shown but never acknowledged: it is owed to
      // the reader and is about to be presented again, not walked past.
      if (this.state.pendingStory === this.state.storyStage) break;
      this.state.storyStage += 1;
    }
  }

  get streakDays(): number { return this.state.streakDays; }
  get bestStreakDays(): number { return Math.max(this.state.bestStreakDays ?? 0, this.state.streakDays); }
  /** The app-day of the newest completion — lets the UI show a streak as fed or hungry. */
  get lastCompletionDay(): string { return this.state.lastCompletionDay; }

  /**
   * The bookkeeping half of handle() with no lottery and no presentation.
   * Automation silences delight, but silence must not mean amnesia — the
   * streak (and the fed-today state the UI muting rides on) still has to
   * advance when a completion happens under webdriver.
   */
  noteQuietly(event: EggEvent): void {
    if (event !== 'taskCompleted') return;
    this.touchStreak(appDayKey(this.now(), this.rolloverHour));
    this.persist();
  }
  get triviaStats(): { correct: number; total: number } { return { ...this.state.trivia }; }
  get unlocks(): string[] { return [...this.state.unlocks]; }
  get storyStage(): number { return this.state.storyStage; }

  private persist(): void {
    void this.saveFn({ ...this.state });
  }

  /** How many times this event has already presented in the current app-day. */
  private presentedTodayFor(event: EggEvent, day: string): number {
    if (this.state.presentedDay !== day) return 0; // a new day wipes the tallies
    return this.state.presentedTodayBy?.[event] ?? 0;
  }

  private touchStreak(day: string): void {
    if (this.state.lastCompletionDay === day) return;
    const yesterday = appDayKey(new Date(this.now().getTime() - 24 * 3600_000), this.rolloverHour);
    this.state.streakDays = this.state.lastCompletionDay === yesterday ? this.state.streakDays + 1 : 1;
    this.state.bestStreakDays = Math.max(this.state.bestStreakDays ?? 0, this.state.streakDays);
    this.state.lastCompletionDay = day;
  }

  /** The one entry point: report an event, maybe get one presentation back. */
  handle(event: EggEvent, partial: Partial<Omit<EggContext, 'event' | 'now' | 'rng'>>): Presentation | null {
    const now = this.now();
    const day = appDayKey(now, this.rolloverHour);
    if (event === 'taskCompleted') this.touchStreak(day);

    // When did a story beat last show? Derived from the seen map (each beat
    // is its own entry), so it syncs and survives restarts for free.
    let lastStoryAt = 0;
    for (const [id, row] of Object.entries(this.state.seen)) {
      if (id.startsWith('story-') && row.lastAt > lastStoryAt) lastStoryAt = row.lastAt;
    }

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
      // APP-DAYS between, not 24h floors. The rolling-24h version meant a
      // beat shown at 12:40pm kept the next one gated until 12:40pm the
      // FOLLOWING day — most of every day ineligible, and the intended
      // beat-a-day cadence decayed into 3–4 day gaps no weight could fix
      // (2026-08-19 retune). "A different day" is what the gate means.
      daysSinceStoryBeat: lastStoryAt === 0
        ? null
        : -daysUntilDeadline(
            appDayKey(new Date(lastStoryAt), this.rolloverHour), now, this.rolloverHour),
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
      const gap = this.eventGapMs[ctx.event] ?? this.minGapMs;
      if (ts - this.state.lastPresentedAt < gap) return null;
      if (presentedToday >= this.maxPerDayGlobal) return null;
      const eventCap = this.maxPerDayByEvent[ctx.event];
      if (eventCap !== undefined && this.presentedTodayFor(ctx.event, day) >= eventCap) return null;
      if (this.rng() > (this.baseChance[ctx.event] ?? 0)) return null;
      pool = eligible;
    }

    const weightOf = (e: EggDef) => (typeof e.weight === 'function' ? e.weight(ctx) : e.weight);
    const total = pool.reduce((s, e) => s + weightOf(e), 0);
    let roll = this.rng() * total;
    let chosen = pool[pool.length - 1]!;
    for (const egg of pool) {
      roll -= weightOf(egg);
      if (roll <= 0) { chosen = egg; break; }
    }

    const prior = this.state.seen[chosen.id];
    this.state.seen[chosen.id] = {
      count: (prior?.count ?? 0) + 1,
      lastAt: ts,
      day,
      dayCount: prior?.day === day ? (prior.dayCount ?? 0) + 1 : 1,
    };
    const perEvent = this.state.presentedDay === day ? { ...this.state.presentedTodayBy } : {};
    perEvent[ctx.event] = (perEvent[ctx.event] ?? 0) + 1;
    this.state.presentedTodayBy = perEvent;
    this.state.lastPresentedAt = ts;
    this.state.presentedDay = day;
    this.state.presentedToday = presentedToday + 1;
    const shown = chosen.present(ctx);
    // A beat is owed an acknowledgement from the moment it appears.
    if (shown.kind === 'story') this.state.pendingStory = shown.stage - 1;
    return shown;
  }

  recordTrivia(correct: boolean): void {
    this.state.trivia.total += 1;
    if (correct) this.state.trivia.correct += 1;
    this.persist();
  }

  /**
   * Take on progress that arrived from another device.
   *
   * The engine keeps its state in memory and rewrites the whole blob on every
   * event, so a sync that only updated storage would be silently undone by the
   * next completion. This folds the incoming values in by the same rules the
   * merge uses — union and maxima, so nothing already earned can be taken away
   * — and leaves this device's pacing untouched.
   *
   * Returns true if anything actually changed, so callers can refresh the UI
   * without doing so on every quiet sync.
   */
  absorb(progress: {
    unlocks: string[]; storyStage: number;
    triviaCorrect: number; triviaTotal: number;
    streakDays: number; lastCompletionDay: string;
    bestStreakDays?: number;
    unlockGrants?: Record<string, number>;
    unlockRevokes?: Record<string, number>;
  }): boolean {
    const before = JSON.stringify([
      this.state.unlocks, this.state.storyStage, this.state.trivia,
      this.state.streakDays, this.state.lastCompletionDay, this.state.bestStreakDays,
      this.state.unlockGrants, this.state.unlockRevokes,
    ]);
    const maxByKey = (a: Record<string, number> = {}, b: Record<string, number> = {}) => {
      const out = { ...a };
      for (const [k, v] of Object.entries(b)) out[k] = Math.max(out[k] ?? 0, v);
      return out;
    };
    this.state.unlockGrants = maxByKey(this.state.unlockGrants, progress.unlockGrants);
    this.state.unlockRevokes = maxByKey(this.state.unlockRevokes, progress.unlockRevokes);
    this.state.unlocks = resolveHeldUnlocks(
      [...new Set([...this.state.unlocks, ...progress.unlocks])],
      this.state.unlockGrants, this.state.unlockRevokes);
    this.state.storyStage = Math.max(this.state.storyStage, progress.storyStage);
    this.state.trivia = {
      correct: Math.max(this.state.trivia.correct, progress.triviaCorrect),
      total: Math.max(this.state.trivia.total, progress.triviaTotal),
    };
    // The streak is a single number whose meaning depends on when it was last
    // touched, so the more recent side wins rather than the larger one.
    if (progress.lastCompletionDay > this.state.lastCompletionDay) {
      this.state.streakDays = progress.streakDays;
      this.state.lastCompletionDay = progress.lastCompletionDay;
    } else if (progress.lastCompletionDay === this.state.lastCompletionDay) {
      this.state.streakDays = Math.max(this.state.streakDays, progress.streakDays);
    }
    // The record is a plain maximum — an old device that never tracked it
    // reports its CURRENT streak as the floor, so it can't zero the record.
    this.state.bestStreakDays = Math.max(
      this.state.bestStreakDays ?? 0, this.state.streakDays,
      progress.bestStreakDays ?? progress.streakDays,
    );
    const changed = JSON.stringify([
      this.state.unlocks, this.state.storyStage, this.state.trivia,
      this.state.streakDays, this.state.lastCompletionDay, this.state.bestStreakDays,
      this.state.unlockGrants, this.state.unlockRevokes,
    ]) !== before;
    if (changed) this.persist();
    return changed;
  }

  /** True if newly granted; false if already discovered. */
  grantUnlock(id: string): boolean {
    if (this.state.unlocks.includes(id)) return false;
    // Stamped past any standing revocation, never merely "now": an earn is an
    // eyewitness event and must win even against a skewed device clock.
    const at = Math.max(this.now().getTime(), (this.state.unlockRevokes?.[id] ?? 0) + 1);
    this.state.unlockGrants = { ...this.state.unlockGrants, [id]: at };
    this.state.unlocks = resolveHeldUnlocks(
      [...this.state.unlocks, id], this.state.unlockGrants, this.state.unlockRevokes);
    this.persist();
    return true;
  }

  /**
   * Take back an unlock as of a specific moment — the repair path for one that
   * was granted by accident (see DelightProgress.unlockGrants). The timestamp
   * is the caller's, not the clock's, so every device revoking the same
   * incident writes the same clock entry and converges. A grant NEWER than
   * `atMs` still wins: revoking yesterday's accident can never confiscate a
   * discovery genuinely earned since. Returns true when it removed something.
   */
  revokeUnlock(id: string, atMs: number): boolean {
    const hadIt = this.state.unlocks.includes(id);
    const prior = this.state.unlockRevokes?.[id] ?? 0;
    if (atMs > prior) {
      this.state.unlockRevokes = { ...this.state.unlockRevokes, [id]: atMs };
      this.state.unlocks = resolveHeldUnlocks(
        this.state.unlocks, this.state.unlockGrants, this.state.unlockRevokes);
      this.persist();
    }
    return hadIt && !this.state.unlocks.includes(id);
  }

  /**
   * The reader acknowledged a beat: the story moves on and the debt clears.
   * Only ever forward — and only this settles pendingStory, which is what
   * makes an unread beat come back instead of vanishing.
   */
  advanceStory(toStage: number): void {
    const owed = this.state.pendingStory;
    const settles = owed !== undefined && toStage >= owed + 1;
    if (toStage <= this.state.storyStage && !settles) return;
    if (toStage > this.state.storyStage) this.state.storyStage = toStage;
    if (settles) this.state.pendingStory = undefined;
    this.persist();
  }

  /** The beat still owed an acknowledgement, if any (see EggState.pendingStory). */
  get pendingStory(): number | undefined { return this.state.pendingStory; }

  /**
   * Record the same debt for a beat shown outside the picker (the forced
   * entry automation uses). Bookkeeping must not depend on which door the
   * beat came through, or tests exercise a story the app never really tells.
   */
  noteStoryShown(stage: number): void {
    this.state.pendingStory = stage - 1;
    this.persist();
  }
}
