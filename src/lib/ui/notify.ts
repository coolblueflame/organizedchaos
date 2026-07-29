/**
 * Notification permission is requested when a TIMEBOX STARTS, not when it
 * fires (2026-07-29 ask): the permission prompt needs a user gesture, and by
 * the time a timer fires the app may be backgrounded — where a prompt cannot
 * appear at all, so the finish alert silently never happens. Asking up front
 * makes the very first timebox's alert deliverable.
 */
export function ensureNotificationPermission(): void {
  try {
    if (typeof window === 'undefined' || !('Notification' in window)) return;
    if (Notification.permission === 'default') void Notification.requestPermission();
  } catch {
    /* no notifications — the in-app flash/beep/haptics still fire */
  }
}
