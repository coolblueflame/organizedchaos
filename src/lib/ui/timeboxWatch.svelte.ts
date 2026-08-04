/**
 * The timebox alarm, watched app-wide.
 *
 * It used to live inside the Timebox component, which only exists on the
 * current-task card — so walking to any other screen unmounted the timer and
 * the alert simply never fired (reported 2026-08-03). The countdown is a
 * per-task display and stays there; the ALARM belongs to the app.
 *
 * Honest limit, unchanged and unfixable from here: while iOS has the whole app
 * suspended, no timer of ours runs at all. A true alarm through that needs a
 * server pushing at a scheduled time, which this app deliberately doesn't
 * have. What we can do — and now do — is fire the moment the app is alive
 * again, so a box that ran out in your pocket announces itself on return
 * instead of being silently swallowed.
 */
import type { List, Task } from '../domain/types';
import { burstAt, motionOk } from './fx/particles';
import { haptic } from './fx/haptics';

/** taskId → the deadline we already announced, so a box alarms exactly once. */
const announced = new Map<string, number>();

function notify(task: Task, lists: List[]): void {
  try {
    if (!('Notification' in window)) return;
    // No prompt here: permission was asked for when the box started (a real
    // gesture); a backgrounded app cannot raise a prompt at fire time anyway.
    if (Notification.permission !== 'granted') return;
    // Renders OUTSIDE the app, on a lock screen the PIN cannot gate — a locked
    // list's task is never named, whatever the session's lock state is now.
    const locked = lists.some((l) => l.id === task.listId && l.locked === true);
    const body = locked ? 'your timebox is up.' : `"${task.name || 'your task'}" — time's up.`;
    void navigator.serviceWorker?.getRegistration().then((reg) => {
      // Through the service worker when there is one: those survive a
      // backgrounded tab, where a page-owned Notification may not.
      if (reg) void reg.showNotification('⏳ Timebox finished', { body, tag: 'timebox' });
      else new Notification('⏳ Timebox finished', { body });
    });
  } catch { /* notifications are a bonus, never a requirement */ }
}

/** A short two-tone chime built in code — no asset, works offline. */
function beep(): void {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const gain = ctx.createGain();
    gain.connect(ctx.destination);
    [880, 1320].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq;
      osc.connect(gain);
      const start = ctx.currentTime + i * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
      osc.start(start);
      osc.stop(start + 0.18);
    });
    setTimeout(() => void ctx.close(), 800);
  } catch { /* muted device, autoplay policy — fine */ }
}

/**
 * Announce every timebox that has run out and hasn't been announced yet.
 * Safe to call as often as you like; the ledger keeps it to one per box.
 */
export function checkTimeboxes(
  tasks: Task[],
  lists: List[],
  onFired: (task: Task) => void,
  now = Date.now(),
): void {
  for (const t of tasks) {
    const endsAt = t.timeboxEndsAt;
    if (endsAt === undefined || t.deleted || t.completedAt !== undefined) continue;
    if (endsAt > now) continue;
    if (announced.get(t.id) === endsAt) continue;
    announced.set(t.id, endsAt);

    haptic('heavy');
    try {
      if (motionOk()) burstAt(window.innerWidth / 2, window.innerHeight / 3, { count: 30, power: 1.4 });
    } catch { /* fx never block the alarm */ }
    notify(t, lists);
    beep();
    onFired(t);
  }
}

/** Test seam: forget what has been announced. */
export function resetTimeboxLedger(): void {
  announced.clear();
}
