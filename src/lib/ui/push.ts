/**
 * Web Push plumbing for the serverless reminders (2026-07-30): the app
 * subscribes this device and parks the subscription in the DATA repo, where a
 * GitHub Actions cron (organizedchaos-data/.github/workflows/reminders.yml)
 * reads it each morning and sends the digest — the free CI is the "server".
 */

/**
 * Public half of the VAPID pair; the private half lives only in the data
 * repo's Action secrets and the alarm Worker's secrets (same pair — one
 * identity for both senders). Pair rotated 2026-08-05: subscriptions are
 * bound to this key, so changing it invalidates every existing subscription —
 * each device must re-toggle reminders to re-subscribe.
 */
export const VAPID_PUBLIC_KEY =
  'BAKBna8PAb-a0spGjjSJ3kWJ_J6AT_cm48fnWggS1NcCmOIASbCyJFR6vG7F-h0W17KNo8OMV0lVL8lldmIW8LU';

/** PushManager wants the key as raw bytes, not base64url. */
function applicationServerKey(key: string): Uint8Array {
  const raw = atob(key.replace(/-/g, '+').replace(/_/g, '/'));
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export function pushSupported(): boolean {
  return typeof window !== 'undefined' &&
    'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
}

export async function currentPushSubscription(): Promise<PushSubscription | null> {
  if (!pushSupported()) return null;
  const reg = await navigator.serviceWorker.getRegistration();
  return (await reg?.pushManager.getSubscription()) ?? null;
}

/**
 * Ask permission (must be inside a user gesture) and subscribe this device.
 * Self-hosters pass their own public key (Settings → morning reminders);
 * everyone else gets the built-in pair.
 */
export async function subscribePush(publicKey: string = VAPID_PUBLIC_KEY): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('notification permission was not granted');
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey(publicKey) as BufferSource,
  });
}

/** A human-recognisable name for the subscriptions file. */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone/.test(ua)) return 'iPhone';
  if (/iPad/.test(ua)) return 'iPad';
  if (/Android/.test(ua)) return 'Android';
  if (/Mac/.test(ua)) return 'Mac';
  if (/Win/.test(ua)) return 'PC';
  return 'device';
}
