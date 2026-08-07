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

/**
 * What the server has been told: taskId → fire time.
 *
 * PERSISTED per device (2026-08-06, Ben's report): a session-local ledger
 * could re-SCHEDULE after a reload (idempotent overwrites), but it could
 * never CANCEL — the diff's cancel list comes from these entries, so an
 * alarm scheduled before a reload survived completing its task early and
 * fired anyway. localStorage is the right scope: each device schedules
 * alarms to its own subscription, so its ledger is its own business —
 * task ids and timestamps only, never names.
 */
const STORAGE_KEY = 'oc-alarms-told';
const told = new Map<string, number>();
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return;
    for (const [id, at] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
      if (typeof at === 'number') told.set(id, at);
    }
  } catch { /* unreadable — degrades to the old session-local behaviour */ }
}

function flush(): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(told)));
  } catch { /* storage full/blocked — ditto */ }
}

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

  hydrate(); // lazily, so a reload can still cancel what an earlier session scheduled
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
      if (res.ok) { told.set(s.taskId, s.at); flush(); } // only a confirmed send updates the ledger
    } catch { /* worker unreachable — the next diff retries by convergence */ }
  }

  for (const taskId of plan.cancel) {
    try {
      const res = await send(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ taskId, action: 'cancel' }),
      });
      if (res.ok) { told.delete(taskId); flush(); }
    } catch { /* ditto */ }
  }
}

/** Test seam. `keepStorage` simulates a reload: memory gone, device ledger kept. */
export function resetAlarmLedger(keepStorage = false): void {
  told.clear();
  hydrated = false;
  subscription = null;
  subscriptionAsked = false;
  if (!keepStorage) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    } catch { /* nothing to forget */ }
  }
}
