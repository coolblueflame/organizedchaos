/**
 * Keeps the alarm Worker's appointments in step with reality.
 *
 * Runs the alarmPlan DIFF (what should be scheduled vs what we've told the
 * server) and ships the delta — a design chosen because timeboxEndsAt is
 * written from eight places and a hook on each would eventually miss one.
 * The plan is cheap, so it rides the same 1s sweep as the local watcher and
 * almost always produces nothing to send.
 *
 * Failure posture: fire-and-forget with re-try by convergence. A failed POST
 * leaves the ledger unchanged, so the very next non-empty diff repeats it.
 * The Worker being down costs exactly the feature it provides and nothing
 * else — which is what keeps the app's no-hosting promise honest.
 */
import { alarmBody, alarmPlan } from '../domain/alarmPlan';
import { lockedListIds } from '../domain/lock';
import type { List, Settings, Task } from '../domain/types';

/** What the server has been told: taskId → fire time. Session-local: on a
 *  fresh load the diff simply re-schedules everything live, which the
 *  Worker's per-task overwrite semantics make idempotent. */
const told = new Map<string, number>();

let subscription: PushSubscription | null = null;
let subscriptionAsked = false;

async function pushSubscription(): Promise<PushSubscription | null> {
  if (subscriptionAsked) return subscription;
  subscriptionAsked = true;
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    subscription = (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    subscription = null;
  }
  return subscription;
}

/** One sweep. Exposed (with the ledger reset) for tests; App calls it on a timer. */
export async function syncAlarms(
  tasks: Task[],
  lists: List[],
  settings: Settings,
  now = Date.now(),
  send: typeof fetch = fetch,
): Promise<void> {
  const url = settings.alarmWorkerUrl?.trim();
  const secret = settings.alarmWorkerSecret;
  if (!url || !secret) return; // not configured — the feature simply isn't on

  const plan = alarmPlan(tasks, told, now);
  if (plan.schedule.length === 0 && plan.cancel.length === 0) return;

  const sub = await pushSubscription();
  if (!sub) return; // no push subscription yet — nothing the server could do

  const locked = lockedListIds(lists, false);
  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${secret}`,
  };

  for (const s of plan.schedule) {
    const task = tasks.find((t) => t.id === s.taskId);
    try {
      const res = await send(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          taskId: s.taskId,
          action: 'set',
          at: s.at,
          subscription: sub.toJSON(),
          title: '⏳ Timebox finished',
          // The push lands on a lock screen the PIN cannot gate — a locked
          // list's task is never named, same rule as every notification.
          body: alarmBody(s.name, task ? locked.has(task.listId) : false),
        }),
      });
      if (res.ok) told.set(s.taskId, s.at); // only a confirmed send updates the ledger
    } catch { /* worker unreachable — the next diff retries by convergence */ }
  }

  for (const taskId of plan.cancel) {
    try {
      const res = await send(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ taskId, action: 'cancel' }),
      });
      if (res.ok) told.delete(taskId);
    } catch { /* ditto */ }
  }
}

/** Test seam. */
export function resetAlarmLedger(): void {
  told.clear();
  subscription = null;
  subscriptionAsked = false;
}
