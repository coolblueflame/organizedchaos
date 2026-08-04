/**
 * Keeping a remote alarm scheduler in step with the timeboxes that actually
 * exist (2026-08-05, after measuring push delivery at ~0.9s).
 *
 * Deliberately a DIFF rather than hooks on the start/clear paths.
 * `timeboxEndsAt` is written from eight places already — starting a box,
 * clearing it, completing the task, undoing that completion, accepting a task
 * with a default box, a ritual finishing — and every one of those is a chance
 * for a future call site to forget to tell the server. Comparing what SHOULD
 * be scheduled against what we have told it cannot be forgotten, and is
 * idempotent: run it as often as you like, it converges.
 */
import type { Task } from './types';

export interface AlarmPlan {
  /** Boxes the server does not yet know about, or knows with the wrong time. */
  schedule: Array<{ taskId: string; at: number; name: string }>;
  /** Boxes the server thinks are live that no longer are. */
  cancel: string[];
}

/**
 * @param scheduled what we have already told the server, taskId → fire time
 * @param now boxes already past are not worth scheduling; the local watcher
 *        announces those the moment the app is looking, and a push for a
 *        deadline that has gone is just noise arriving late.
 */
export function alarmPlan(
  tasks: Task[],
  scheduled: ReadonlyMap<string, number>,
  now: number,
): AlarmPlan {
  const wanted = new Map<string, Task>();
  for (const t of tasks) {
    if (t.deleted || t.completedAt !== undefined) continue;
    if (t.timeboxEndsAt === undefined || t.timeboxEndsAt <= now) continue;
    wanted.set(t.id, t);
  }

  const schedule: AlarmPlan['schedule'] = [];
  for (const [taskId, task] of wanted) {
    if (scheduled.get(taskId) === task.timeboxEndsAt) continue; // already correct
    schedule.push({ taskId, at: task.timeboxEndsAt!, name: task.name });
  }

  const cancel: string[] = [];
  for (const taskId of scheduled.keys()) {
    if (!wanted.has(taskId)) cancel.push(taskId);
  }

  return { schedule, cancel };
}

/**
 * What the alarm should say when it lands. Mirrors the local alarm's wording,
 * including its rule: a locked list's task is NEVER named, because this
 * renders on a lock screen the PIN cannot gate.
 */
export function alarmBody(name: string, inLockedList: boolean): string {
  return inLockedList ? 'your timebox is up.' : `"${name || 'your task'}" — time's up.`;
}
