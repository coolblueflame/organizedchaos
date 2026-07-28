/**
 * Organized Chaos domain types (spec §3).
 *
 * Conventions used across every entity:
 * - timestamps (`createdAt`, `updatedAt`, `notTodayUntil`, ...) are ms-epoch numbers
 * - calendar dates (`deadline`) are LOCAL 'YYYY-MM-DD' strings — deadlines are dates, not moments
 * - deletes are tombstones (`deleted: true`) so the future sync layer can merge them;
 *   `updatedAt` is stamped on every write and is the newest-wins merge key
 */

export type Priority = 'someday' | 'low' | 'medium' | 'high' | 'max';

/** Ascending order — index doubles as the comparable rank. */
export const PRIORITIES = ['someday', 'low', 'medium', 'high', 'max'] as const satisfies readonly Priority[];

/** someday=0 … max=4; higher wins everywhere priorities are compared. */
export function priorityRank(p: Priority): number {
  return PRIORITIES.indexOf(p);
}

export type SortMode = 'priority' | 'date' | 'tag';

interface Base {
  id: string;
  createdAt: number;
  updatedAt: number;
  deleted: boolean;
}

export interface List extends Base {
  title: string;
  /** Display grouping label on the home screen (imported from Things areas). */
  areaGroup?: string;
  /**
   * Manual position on the home screen, low to high, within its group
   * (2026-07-28 request: pin the important list up top, sink the cruft).
   * Absent on anything never dragged — those keep their existing order, which
   * is why the comparator has to treat "no order" as "stay put" rather than
   * as zero.
   */
  order?: number;
  /** Last sort mode used in this list's view (spec §6: remembered per list). */
  sortMode: SortMode;
  /**
   * Optional local-time window ('HH:MM') during which the randomizer may draw
   * from this list; may wrap past midnight. Both must be set to take effect.
   */
  activeFrom?: string;
  activeTo?: string;
  /**
   * Weekday-aware windows (supersedes activeFrom/activeTo, which is still read
   * for older data). Each rule covers a set of weekdays and a time range.
   */
  hours?: import('./schedule').HoursRule[];
  /**
   * When the list is outside its window, let its MAX-priority tasks through
   * anyway — "off the clock, unless something's on fire."
   */
  urgentOverridesHours?: boolean;
  /**
   * Project deadline: the whole list should be finished by this local date.
   * Escalates every task in the list based on the list's TOTAL remaining
   * estimate rather than each task's own (spec §4, project escalation).
   */
  deadline?: string;
  /** Source Things project/area uuid — makes re-imports idempotent (spec §9). */
  thingsUuid?: string;
}

export interface Task extends Base {
  listId: string;
  name: string;
  /** Freeform markdown; imported Things checklists live here as `- [ ]` lines. */
  notes: string;
  /** Manual priority; deadline escalation may raise the effective value (spec §4). */
  priority: Priority;
  tagIds: string[];
  deadline?: string;
  estimateHours?: number;
  /** Set when a task is accepted from the randomizer; cleared only manually. */
  inProgress: boolean;
  /** "Not Today" snooze — excludes from the randomizer pool ONLY, until this moment. */
  notTodayUntil?: number;
  completedAt?: number;
  /** The RecurrenceTemplate this task was spawned from, if any. */
  recurrenceId?: string;
  /** Original Things UUID — makes re-imports idempotent (spec §9). */
  thingsUuid?: string;
  /**
   * "Not triaged yet" flag: set on import and on manual creation, cleared the
   * moment the user deliberately opens the task or touches any field other
   * than its name. Drives the row dot and the randomizer's fill-in prompts.
   */
  needsReview?: boolean;
  /**
   * Completed work that came in from an import and shouldn't inflate the
   * scoreboard. It still lives in the app and still feeds the over-time
   * graphs — it just isn't counted as something YOU finished here.
   */
  importedHistory?: boolean;
  /**
   * Start of the CURRENT working stretch; set while in progress, cleared when
   * paused. Time only counts when you're actually working on something.
   */
  startedAt?: number;
  /** Time banked from earlier stretches, before the current one. */
  activeAccumulatedMs?: number;
  /**
   * Final tracked duration, written only when a task is completed while in
   * progress. Ticking something off the list without ever working on it (or
   * after pausing) records nothing — that time was never tracked.
   */
  activeMs?: number;
  /** Minutes to spend on it; set per task, or inherited from its template. */
  timeboxMinutes?: number;
  /** When the running timebox expires; absent when no timer is running. */
  timeboxEndsAt?: number;
  /**
   * Ids of tasks that must be finished before this one can be worked on
   * (2026-07-27 request). While any of them is still open the randomizer skips
   * this task, and each blocker is drawn at the priority of the work it is
   * holding up. See domain/blocking.ts.
   */
  blockedBy?: string[];
}

export interface Tag extends Base {
  name: string;
  /** Index into the 16-color preset swatch (spec §7). */
  colorIndex: number;
  /** Source Things tag/heading uuid — makes re-imports idempotent (spec §9). */
  thingsUuid?: string;
}

export type RecurrenceMode =
  /** "Come back X after completion" — spec §5. */
  | { kind: 'afterCompletion'; interval: number; unit: 'days' | 'weeks' | 'months' }
  /** Fixed weekly cadence; weekday numbers follow JS Date#getDay (0=Sunday … 6=Saturday). */
  | { kind: 'weekly'; weekdays: number[] }
  /** Fixed monthly cadence; 1–31, clamped to the month's length when it overshoots. */
  | { kind: 'monthly'; dayOfMonth: number };

export interface RecurrenceTemplate extends Base {
  listId: string;
  name: string;
  notes: string;
  tagIds: string[];
  priority: Priority;
  estimateHours?: number;
  mode: RecurrenceMode;
  /** When set, spawned tasks get `deadline = spawn day + offset` (spec §5). */
  deadlineOffsetDays?: number;
  paused: boolean;
  /** Default timebox handed to each spawned instance. */
  timeboxMinutes?: number;
  /** Rolling average of how long instances actually take, and the sample count. */
  avgActiveMs?: number;
  completedInstances?: number;
  /** Next moment the spawn sweep should materialize an instance; unset = not armed. */
  nextSpawnAt?: number;
  lastSpawnedTaskId?: string;
  /** Source Things repeating-template uuid — makes re-imports idempotent (spec §9). */
  thingsUuid?: string;
}

export interface CurrentTaskRef {
  taskId: string;
  acceptedAt: number;
}

export interface Settings {
  /** Assumed focus hours available per day per task — drives deadline escalation. */
  hoursPerDay: number;
  /** Width (in days of slack) of each escalation band below max. */
  slackBandDays: number;
  /** Local hour at which the "app day" rolls over (spec §3: the 4am rule). */
  rolloverHour: number;
  /** Completing the current task immediately draws + accepts the next one. */
  autoSelectNext: boolean;
  /** Last list used from quick add, so capture always lands where you left it. */
  quickAddListId?: string;
}

export const DEFAULT_SETTINGS: Settings =
  { hoursPerDay: 1, slackBandDays: 3, rolloverHour: 4, autoSelectNext: false };

/** What callers provide to create a task; base fields are stamped by the storage layer. */
export type TaskDraft = Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>;
