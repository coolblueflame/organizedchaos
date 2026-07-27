/**
 * Deadline-based priority escalation (spec §4).
 *
 * The idea: assume the user can put `hoursPerDay` into any one task, so a task
 * needs `ceil(estimate / hoursPerDay)` working days. The days remaining beyond
 * that are slack; as slack evaporates, priority climbs:
 *
 *   slack = daysUntil(deadline) − workDays
 *   slack ≤ 0        → max
 *   slack ≤ band     → high      (band = settings.slackBandDays, default 3)
 *   slack ≤ band × 2 → medium
 *   otherwise        → low       (the floor — a deadlined task is never someday)
 */
import { daysUntilDeadline } from './time';
import { priorityRank, type Priority, type Settings, type Task } from './types';

export function derivedPriority(
  task: Pick<Task, 'deadline' | 'estimateHours'>,
  settings: Settings,
  now: Date,
): Priority | null {
  if (!task.deadline) return null;
  const workDays = Math.ceil((task.estimateHours ?? 1) / settings.hoursPerDay);
  const slack = daysUntilDeadline(task.deadline, now, settings.rolloverHour) - workDays;
  if (slack <= 0) return 'max';
  if (slack <= settings.slackBandDays) return 'high';
  if (slack <= settings.slackBandDays * 2) return 'medium';
  return 'low';
}

/** max(manual, derived) — a deadline only ever raises priority, never lowers it. */
export function effectivePriority(
  task: Pick<Task, 'deadline' | 'estimateHours' | 'priority'>,
  settings: Settings,
  now: Date,
): Priority {
  const derived = derivedPriority(task, settings, now);
  if (derived === null) return task.priority;
  return priorityRank(derived) > priorityRank(task.priority) ? derived : task.priority;
}

/** True when the deadline is what's driving the tier — the UI shows a flame for these. */
/**
 * The tier a task actually competes at: its own effective priority, lifted by
 * whichever outside pressure is strongest — its list's project deadline
 * (domain/project.ts) or the work waiting on it (domain/blocking.ts). Pass
 * `null`/undefined for either when it does not apply.
 */
export function drawPriority(
  task: Pick<Task, 'deadline' | 'estimateHours' | 'priority'>,
  settings: Settings,
  now: Date,
  projectTier?: Priority | null,
  blockLift?: Priority | null,
): Priority {
  let best = effectivePriority(task, settings, now);
  for (const lift of [projectTier, blockLift]) {
    if (lift && priorityRank(lift) > priorityRank(best)) best = lift;
  }
  return best;
}

export function isEscalated(
  task: Pick<Task, 'deadline' | 'estimateHours' | 'priority'>,
  settings: Settings,
  now: Date,
): boolean {
  const derived = derivedPriority(task, settings, now);
  return derived !== null && priorityRank(derived) > priorityRank(task.priority);
}
