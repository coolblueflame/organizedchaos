/**
 * Daily rituals — the things you do every day at roughly the same time, rather
 * than tasks you work through: eat lunch, make supper, get ready for bed.
 *
 * These behave unlike anything else in the app, and the difference is the whole
 * point. A recurring task SPAWNS a fresh copy each period, so a week of not
 * opening the app leaves seven of them waiting — which is exactly wrong here.
 * You did eat lunch on Tuesday; you just weren't looking at a todo list at the
 * time. Being nagged about it on Friday is worse than useless.
 *
 * So a ritual is ONE task that never multiplies. Inside its window, if it has
 * not been done today, the randomizer treats it as the most urgent thing you
 * have — that is the reminder. Outside the window, or once it is done, it steps
 * out of the draw entirely and waits for tomorrow. A missed day leaves no trace.
 */
import { appDayKey } from './time';
import type { HoursRule } from './schedule';
import { ruleActiveAt } from './schedule';
import type { Priority, Settings, Task } from './types';

/**
 * - `due` — inside the window and not yet done today: the randomizer's problem
 * - `done` — already done today, whatever the clock says
 * - `waiting` — a ritual, but not right now
 * - `null` — an ordinary task
 */
export type RitualState = 'due' | 'done' | 'waiting' | null;

export function ritualState(task: Task, now: Date, rolloverHour: number): RitualState {
  if (!task.ritual) return null;
  if (task.ritualDoneDay === appDayKey(now, rolloverHour)) return 'done';
  return ruleActiveAt(task.ritual, now) ? 'due' : 'waiting';
}

/** Convenience for the UI, which mostly wants the one question. */
export function isRitualDue(task: Task, now: Date, rolloverHour: number): boolean {
  return ritualState(task, now, rolloverHour) === 'due';
}

/**
 * Ritual tasks that must NOT be drawn right now — folded into the draw's
 * exclusions the same way the per-list hours are, which keeps the randomizer
 * itself free of any knowledge about them.
 */
export function ritualExclusions(tasks: Task[], settings: Settings, now: Date): string[] {
  return tasks
    .filter((t) => t.ritual && ritualState(t, now, settings.rolloverHour) !== 'due')
    .map((t) => t.id);
}

/**
 * A due ritual outranks everything. Not a nudge: the window is the point, and a
 * reminder that loses to a big pile of ordinary work never arrives at all.
 * Expressed as a priority lift so it travels the same path as the pressure a
 * blocked task already applies to its blockers.
 */
export function ritualLifts(tasks: Task[], settings: Settings, now: Date): Map<string, Priority> {
  const lifts = new Map<string, Priority>();
  for (const task of tasks) {
    if (isRitualDue(task, now, settings.rolloverHour)) lifts.set(task.id, 'max');
  }
  return lifts;
}

/** Merge ritual pressure over whatever the blocking graph worked out. */
export function withRitualLifts(
  lifts: Map<string, Priority>,
  tasks: Task[],
  settings: Settings,
  now: Date,
): Map<string, Priority> {
  const merged = new Map(lifts);
  for (const [id, priority] of ritualLifts(tasks, settings, now)) merged.set(id, priority);
  return merged;
}

/** "every day 12:00–14:00" / "Mon–Fri 21:30–23:00", for the row and the editor. */
export function describeRitual(rule: HoursRule): string {
  const NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const days = [...rule.days].sort((a, b) => a - b);
  const when =
    days.length === 7 ? 'every day'
      : days.length === 5 && days.every((d) => d >= 1 && d <= 5) ? 'weekdays'
        : days.length === 2 && days.includes(0) && days.includes(6) ? 'weekends'
          : days.map((d) => NAMES[d]).join(' ');
  return `${when} ${rule.from}–${rule.to}`;
}
