/**
 * Recurrence engine (spec §5).
 *
 * Templates are the durable objects; tasks are their disposable instances.
 * Two modes:
 *  - afterCompletion: completing an instance arms `nextSpawnAt = completion + interval`
 *    ("come back X after done" — the task stays gone until then).
 *  - weekly/monthly schedule: `nextSpawnAt` always holds the next cadence moment
 *    (rolloverHour on a due day).
 * The spawn sweep runs at app open/focus and at the 4am rollover, materializing
 * every template whose `nextSpawnAt` has passed.
 */
import { addDaysKey, appDayKey } from './time';
import type { RecurrenceMode, RecurrenceTemplate, Settings, Task, TaskDraft } from './types';

/** Month-add with clamping (Jan 31 + 1mo → Feb 28) — JS Date would overflow into March. */
function addMonthsClamped(d: Date, months: number): Date {
  const day = d.getDate();
  const target = new Date(d.getTime());
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

/** afterCompletion: the moment the next instance should appear; null for scheduled modes. */
export function scheduleAfterCompletion(tpl: RecurrenceTemplate, completedAt: Date): number | null {
  const m = tpl.mode;
  if (m.kind !== 'afterCompletion') return null;
  if (m.unit === 'months') return addMonthsClamped(completedAt, m.interval).getTime();
  const days = m.unit === 'weeks' ? m.interval * 7 : m.interval;
  const d = new Date(completedAt.getTime());
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Weekly/monthly: the next spawn moment (rolloverHour on a due day), strictly after `after`. */
export function nextScheduledSpawn(mode: RecurrenceMode, after: Date, rolloverHour: number): number | null {
  if (mode.kind === 'weekly') {
    if (mode.weekdays.length === 0) return null;
    for (let i = 0; i <= 7; i++) {
      const c = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i, rolloverHour);
      if (c.getTime() > after.getTime() && mode.weekdays.includes(c.getDay())) return c.getTime();
    }
    return null; // unreachable with a non-empty weekday set
  }
  if (mode.kind === 'monthly') {
    // Check this month and the next two — enough to skate past short-month clamping.
    for (let i = 0; i <= 2; i++) {
      const first = new Date(after.getFullYear(), after.getMonth() + i, 1);
      const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const c = new Date(first.getFullYear(), first.getMonth(), Math.min(mode.dayOfMonth, lastDay), rolloverHour);
      if (c.getTime() > after.getTime()) return c.getTime();
    }
    return null; // unreachable
  }
  return null;
}

export interface SweepResult {
  drafts: TaskDraft[];
  updates: Array<{ id: string; nextSpawnAt: number | undefined }>;
}

/** Materialize every due template. Pure — the caller persists drafts and updates. */
export function sweepSpawns(
  templates: RecurrenceTemplate[],
  tasks: Task[],
  now: Date,
  settings: Settings,
): SweepResult {
  const res: SweepResult = { drafts: [], updates: [] };
  for (const tpl of templates) {
    if (tpl.paused || tpl.deleted) continue;
    if (tpl.nextSpawnAt === undefined || tpl.nextSpawnAt > now.getTime()) continue;

    // Skip-if-open (spec §5): don't pile up "water the plants" while one is pending.
    const hasOpenInstance = tasks.some(
      (t) => t.recurrenceId === tpl.id && !t.deleted && t.completedAt === undefined,
    );
    if (!hasOpenInstance) {
      res.drafts.push({
        listId: tpl.listId,
        name: tpl.name,
        notes: tpl.notes,
        priority: tpl.priority,
        tagIds: [...tpl.tagIds],
        estimateHours: tpl.estimateHours,
        timeboxMinutes: tpl.timeboxMinutes,
        deadline:
          tpl.deadlineOffsetDays === undefined
            ? undefined
            : addDaysKey(appDayKey(now, settings.rolloverHour), tpl.deadlineOffsetDays),
        inProgress: false,
        recurrenceId: tpl.id,
      });
    }
    // Scheduled modes advance to the next cadence moment either way; afterCompletion
    // clears — completing the (existing or new) instance re-arms it.
    const next = nextScheduledSpawn(tpl.mode, now, settings.rolloverHour);
    res.updates.push({ id: tpl.id, nextSpawnAt: next ?? undefined });
  }
  return res;
}
