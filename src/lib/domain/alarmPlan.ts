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
 * One line of the ledger: when the box was said to fire, and whether the
 * server actually confirmed it.
 *
 * `confirmed` exists because the two questions the ledger answers pull in
 * opposite directions. "Should I schedule this?" wants to know what the
 * server DEFINITELY has, so an unconfirmed attempt must be retried. "Should
 * I cancel this?" wants to know what the server MIGHT have — and a request
 * sent with keepalive can land after the page stops listening for the
 * answer, so an unconfirmed attempt must still be cancellable. Recording
 * only confirmed sends made those alarms invisible to the cancel pass and
 * they fired over finished work (2026-08-27, the fourth report of it).
 */
export interface AlarmRecord {
  at: number;
  confirmed: boolean;
  /** Failed attempts at this `at` so far (schedule or cancel). */
  tries?: number;
  /** Not before this moment: the entry is backing off after a failure. */
  nextTryAt?: number;
  /**
   * Which request the rest belongs to. A failed SCHEDULE must never delay a
   * cancel: the cancel after a schedule that died mid-flight is the last
   * chance to take back an alarm the server may hold, and it goes out at
   * once; a failed cancel rests on its own account.
   */
  resting?: 'set' | 'cancel';
  /** The last HTTP status the Worker refused with, for the readout. */
  rejected?: number;
}

/**
 * How long an entry rests after its Nth failure: 5s, 10s, 20s… capped at an
 * hour. A retry-by-convergence design that retries on EVERY sweep turns one
 * permanently refused request into a request per second — 86,400 a day from
 * a single open tab, which is how a hobby app blew through Cloudflare's free
 * daily quota (2026-09-19, the account's own 91% warning).
 */
export function backoffMs(tries: number): number {
  return Math.min(3_600_000, 5_000 * 2 ** Math.max(0, tries - 1));
}

/**
 * @param scheduled what we have TRIED to tell the server, taskId → record
 * @param now boxes already past are not worth scheduling; the local watcher
 *        announces those the moment the app is looking, and a push for a
 *        deadline that has gone is just noise arriving late.
 */
export function alarmPlan(
  tasks: Task[],
  scheduled: ReadonlyMap<string, AlarmRecord>,
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
    const known = scheduled.get(taskId);
    // Only a CONFIRMED record at the right time counts as done; an attempt
    // whose answer never arrived is repeated until one does — after its
    // backoff, when it has one for this very deadline. A moved box is a new
    // request and goes out at once.
    if (known?.confirmed && known.at === task.timeboxEndsAt) continue;
    if (known && known.at === task.timeboxEndsAt && (known.nextTryAt ?? 0) > now
      && (known.resting ?? 'set') === 'set') continue;
    schedule.push({ taskId, at: task.timeboxEndsAt!, name: task.name });
  }

  // Every id the ledger mentions, confirmed or not: taking back an alarm that
  // was never scheduled costs one no-op request; missing one alarms over
  // work already finished. A cancel that failed rests like any other entry.
  const cancel: string[] = [];
  for (const [taskId, known] of scheduled) {
    if (wanted.has(taskId)) continue;
    if ((known.nextTryAt ?? 0) > now && known.resting === 'cancel') continue;
    cancel.push(taskId);
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
