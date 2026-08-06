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

/**
 * Local midnight of the Sunday starting the week of `d`'s APP day —
 * Sunday-first like every picker, and rollover-aware like every other piece
 * of day math here (review catch: bucketing the anchor by raw calendar date
 * put a Sunday-00:30 save in the wrong week — the user's clock said Sunday,
 * the app's day model still said Saturday).
 */
function weekStartOfAppDay(d: Date, rolloverHour: number): Date {
  const [y, m, day] = appDayKey(d, rolloverHour).split('-').map(Number);
  const x = new Date(y!, m! - 1, day!);
  x.setDate(x.getDate() - x.getDay());
  return x;
}

/** Whole weeks between two moments' app-day weeks. Math.round eats the ±1h a DST edge adds. */
function weeksBetween(a: Date, b: Date, rolloverHour: number): number {
  return Math.round(
    (weekStartOfAppDay(b, rolloverHour).getTime() - weekStartOfAppDay(a, rolloverHour).getTime())
      / (7 * 86_400_000),
  );
}

/** Weekly/monthly: the next spawn moment (rolloverHour on a due day), strictly after `after`. */
export function nextScheduledSpawn(mode: RecurrenceMode, after: Date, rolloverHour: number): number | null {
  if (mode.kind === 'weekly') {
    if (mode.weekdays.length === 0) return null;
    // Without an anchor there is no way to say WHICH weeks are on — treat as
    // plain weekly rather than let the on-week drift with the search date.
    const every = mode.anchorMs === undefined ? 1 : Math.max(1, mode.everyWeeks ?? 1);
    const anchor = new Date(mode.anchorMs ?? after.getTime());
    for (let i = 0; i <= every * 7 + 7; i++) {
      const c = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i, rolloverHour);
      if (c.getTime() <= after.getTime()) continue;
      if (!mode.weekdays.includes(c.getDay())) continue;
      // ((x % n) + n) % n: weeksBetween goes negative when `after` sits
      // before the anchor week, and JS % keeps the sign.
      if (every > 1 && ((weeksBetween(anchor, c, rolloverHour) % every) + every) % every !== 0) continue;
      return c.getTime();
    }
    return null; // unreachable with a non-empty weekday set
  }
  if (mode.kind === 'monthly') {
    const wanted: Array<number | 'last'> = mode.days?.length ? mode.days : [mode.dayOfMonth];
    // Check this month and the next two — enough to skate past short-month
    // clamping — and take the EARLIEST of all wanted days that lies ahead.
    let best: number | null = null;
    for (let i = 0; i <= 2; i++) {
      const first = new Date(after.getFullYear(), after.getMonth() + i, 1);
      const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      for (const w of wanted) {
        const day = w === 'last' ? lastDay : Math.min(w, lastDay);
        const c = new Date(first.getFullYear(), first.getMonth(), day, rolloverHour);
        if (c.getTime() > after.getTime() && (best === null || c.getTime() < best)) best = c.getTime();
      }
    }
    return best;
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
