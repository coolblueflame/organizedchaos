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
import { alarmBody, alarmPlan, type AlarmRecord } from '../domain/alarmPlan';
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
const told = new Map<string, AlarmRecord>();
let hydrated = false;

function hydrate(): void {
  if (hydrated) return;
  hydrated = true;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null;
    if (!raw) return;
    for (const [id, v] of Object.entries(JSON.parse(raw) as Record<string, unknown>)) {
      // Rows written before the ledger recorded attempts are bare numbers;
      // they describe sends the server confirmed, so they read as confirmed.
      if (typeof v === 'number') told.set(id, { at: v, confirmed: true });
      else if (v && typeof v === 'object' && typeof (v as AlarmRecord).at === 'number') {
        told.set(id, { at: (v as AlarmRecord).at, confirmed: (v as AlarmRecord).confirmed === true });
      }
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

/**
 * Cached once FOUND — never cached as null. The old version asked exactly
 * once per session, and a transient miss (the very first sweep can run
 * before the SW registration settles on an iOS cold start) poisoned the
 * whole session: every later sweep short-circuited, and because the
 * subscription gate ALSO stood in front of the cancel loop, cancels went
 * silently unsent no matter how long the app stayed open. That was the
 * third and real answer to "I completed it early and it still alarmed"
 * (2026-08-10) — the two ledger fixes before it were real but downstream.
 */
async function pushSubscription(): Promise<PushSubscription | null> {
  if (subscription) return subscription;
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

  const headers = {
    'content-type': 'application/json',
    authorization: `Bearer ${secret}`,
  };

  // Scheduling needs somewhere to push TO; cancelling does not. The cancel
  // loop below must NEVER wait on the subscription — see pushSubscription
  // for the session this gate silently ate.
  const sub = plan.schedule.length > 0 ? await pushSubscription() : null;
  if (sub) {
    const locked = lockedListIds(lists, false);
    for (const s of plan.schedule) {
      const task = tasks.find((t) => t.id === s.taskId);
      /*
        Written BEFORE the request, deliberately. keepalive means this POST
        can outlive the page that sent it, so the server may end up holding
        an alarm whose answer nobody was left to hear. An unrecorded alarm is
        one the cancel pass cannot see, and it fires over finished work — the
        exact shape of four separate reports. Recorded unconfirmed, it stays
        cancellable, and the diff still retries it until the server agrees.
      */
      told.set(s.taskId, { at: s.at, confirmed: false });
      flush();
      try {
        const res = await send(url, {
          method: 'POST',
          headers,
          // keepalive: this may be the page's last act before iOS suspends it
          // (complete → pocket the phone) — the request must outlive the page.
          keepalive: true,
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
        if (res.ok) { told.set(s.taskId, { at: s.at, confirmed: true }); flush(); }
      } catch { /* worker unreachable — the next diff retries by convergence */ }
    }
  }

  for (const taskId of plan.cancel) {
    try {
      const res = await send(url, {
        method: 'POST',
        headers,
        keepalive: true, // cancels especially — see the schedule POST's note
        body: JSON.stringify({ taskId, action: 'cancel' }),
      });
      if (res.ok) { told.delete(taskId); flush(); }
    } catch { /* ditto */ }
  }
}

/**
 * What this device believes the Worker is holding for it — the readout behind
 * the Settings line. Exists because "I completed it early and it still
 * alarmed" has been reported four times and every fix before this one was
 * reasoned about without ever being able to SEE the ledger (2026-08-27).
 */
export function scheduledAlarms(): Array<{ taskId: string; at: number; confirmed: boolean }> {
  hydrate();
  return [...told.entries()]
    .map(([taskId, r]) => ({ taskId, at: r.at, confirmed: r.confirmed }))
    .sort((a, b) => a.at - b.at);
}

/**
 * Take back every alarm this device knows about — the manual escape hatch
 * beside the readout. Convergent like the sweep: entries survive a failed
 * send and the next diff tries them again.
 */
export async function cancelAllAlarms(
  settings: Settings, send: typeof fetch = fetch,
): Promise<void> {
  const url = settings.alarmWorkerUrl?.trim();
  const secret = settings.alarmWorkerSecret;
  if (!url || !secret) return;
  hydrate();
  for (const taskId of [...told.keys()]) {
    try {
      const res = await send(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${secret}` },
        keepalive: true,
        body: JSON.stringify({ taskId, action: 'cancel' }),
      });
      if (res.ok) { told.delete(taskId); flush(); }
    } catch { /* the sweep will keep trying */ }
  }
}

/** Test seam. `keepStorage` simulates a reload: memory gone, device ledger kept. */
export function resetAlarmLedger(keepStorage = false): void {
  told.clear();
  hydrated = false;
  subscription = null;
  if (!keepStorage) {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    } catch { /* nothing to forget */ }
  }
}
