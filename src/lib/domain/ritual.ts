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

/** All of a ritual's windows: the multi-window list, or the legacy single rule. */
export function ritualWindows(task: Task): HoursRule[] {
  if (task.rituals && task.rituals.length > 0) return task.rituals;
  return task.ritual ? [task.ritual] : [];
}

export function isRitualTask(task: Task): boolean {
  return ritualWindows(task).length > 0;
}

/** Done-mark key for one window on one app-day. */
export function ritualSlot(day: string, windowIndex: number): string {
  return `${day}#${windowIndex}`;
}

/** Which window indices are already marked for `day`. */
function markedOn(task: Task, day: string): Set<number> {
  const out = new Set<number>();
  for (const s of task.ritualDoneSlots ?? []) {
    const [d, i] = s.split('#');
    if (d === day) out.add(Number(i));
  }
  return out;
}

/** Does this ritual track each window separately? (Needs 2+ windows to mean anything.) */
export function isPerWindow(task: Task): boolean {
  return task.ritualPerWindow === true && ritualWindows(task).length > 1;
}

/**
 * The window a completion should credit right now: an active unmarked window
 * when one is open, else the day's first unmarked one — doing it early still
 * counts (the window is when the app brings it up, not permission). -1 = the
 * whole day is already marked.
 */
export function creditWindowIndex(task: Task, now: Date, rolloverHour: number): number {
  const windows = ritualWindows(task);
  const marked = markedOn(task, appDayKey(now, rolloverHour));
  const active = windows.findIndex((w, i) => !marked.has(i) && ruleActiveAt(w, now));
  if (active !== -1) return active;
  return windows.findIndex((_, i) => !marked.has(i));
}

/** "2 of 3 today" for per-window rituals; null when the plain state says it all. */
export function ritualProgress(
  task: Task,
  now: Date,
  rolloverHour: number,
): { done: number; total: number } | null {
  if (!isPerWindow(task)) return null;
  const windows = ritualWindows(task);
  const marked = markedOn(task, appDayKey(now, rolloverHour));
  return { done: Math.min(marked.size, windows.length), total: windows.length };
}

export function ritualState(task: Task, now: Date, rolloverHour: number): RitualState {
  const windows = ritualWindows(task);
  if (windows.length === 0) return null;
  const day = appDayKey(now, rolloverHour);
  if (isPerWindow(task)) {
    const marked = markedOn(task, day);
    if (marked.size >= windows.length) return 'done';
    if (windows.some((w, i) => !marked.has(i) && ruleActiveAt(w, now))) return 'due';
    // Between windows — or inside one that's already marked, which reads as
    // "done for now": green during the satisfied window, grey once it closes.
    return windows.some((w) => ruleActiveAt(w, now)) ? 'done' : 'waiting';
  }
  if (task.ritualDoneDay === day) return 'done';
  return windows.some((w) => ruleActiveAt(w, now)) ? 'due' : 'waiting';
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
    .filter((t) => isRitualTask(t) && ritualState(t, now, settings.rolloverHour) !== 'due')
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

/**
 * Whole-ritual summary. Windows sharing one day pattern collapse to
 * "every day 09:00–09:30 + 14:00–14:30"; mixed patterns spell each out.
 * Multi-window rituals also say which contract they run under.
 */
export function describeRitualTask(task: Task): string {
  const windows = ritualWindows(task);
  if (windows.length === 0) return '';
  if (windows.length === 1) return describeRitual(windows[0]!);
  const dayKey = (r: HoursRule) => [...r.days].sort((a, b) => a - b).join(',');
  const sameDays = windows.every((w) => dayKey(w) === dayKey(windows[0]!));
  const body = sameDays
    ? `${describeRitual(windows[0]!)}${windows.slice(1).map((w) => ` + ${w.from}–${w.to}`).join('')}`
    : windows.map(describeRitual).join(' · ');
  return `${body} · ${isPerWindow(task) ? 'each time' : 'any one time'}`;
}
