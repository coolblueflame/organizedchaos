/**
 * "Skip this round" (2026-11-18 ask): let a repeating thing go quiet until
 * its next time without claiming it was done. Two kinds can skip:
 *
 * - a repeating copy (weekly, monthly or after-completion rule): the copy is
 *   removed and the rule's next copy arrives when it normally would, an
 *   after-completion rule counting its interval from the skip;
 * - a ritual still owed today: the window it would credit (the whole day,
 *   for a once-a-day ritual) is marked, with no history record.
 *
 * Peppered rules cannot skip: their copy goes straight back into the pool,
 * so "not today" is the only meaningful way to quiet one.
 */
import { creditWindowIndex, isPerWindow, isRitualTask } from './ritual';
import { appDayKey } from './time';
import type { RecurrenceTemplate, Task } from './types';

export type SkipKind = 'repeat' | 'ritual';

/**
 * What a skip would do to this task right now, or null when it can't skip.
 * @param templates every template; the task's own is looked up by id.
 */
export function skipKind(
  task: Task, templates: RecurrenceTemplate[], now: Date, rolloverHour: number,
): SkipKind | null {
  if (task.deleted || task.completedAt !== undefined) return null;
  if (isRitualTask(task)) {
    const owed = isPerWindow(task)
      ? creditWindowIndex(task, now, rolloverHour) !== -1
      : task.ritualDoneDay !== appDayKey(now, rolloverHour);
    return owed ? 'ritual' : null;
  }
  if (!task.recurrenceId) return null;
  const tpl = templates.find((t) => t.id === task.recurrenceId && !t.deleted);
  return tpl && tpl.mode.kind !== 'chance' ? 'repeat' : null;
}

/** True when today's done-mark on this ritual came from a skip. */
export function skippedToday(task: Task, now: Date, rolloverHour: number): boolean {
  const day = appDayKey(now, rolloverHour);
  return (task.ritualSkips ?? []).some((k) => k === day || k.startsWith(`${day}#`));
}

/**
 * True when the ritual has done-marks today and every one of them is a skip:
 * nothing was actually done, so nothing should read as done.
 */
export function onlySkippedToday(task: Task, now: Date, rolloverHour: number): boolean {
  const day = appDayKey(now, rolloverHour);
  const skips = new Set(task.ritualSkips ?? []);
  if (!isPerWindow(task)) return task.ritualDoneDay === day && skips.has(day);
  const marks = (task.ritualDoneSlots ?? []).filter((x) => x.startsWith(`${day}#`));
  return marks.length > 0 && marks.every((x) => skips.has(x));
}
