/**
 * Web Push plumbing for the serverless reminders (2026-07-30): the app
 * subscribes this device and parks the subscription in the DATA repo, where a
 * GitHub Actions cron (organizedchaos-data/.github/workflows/reminders.yml)
 * reads it each morning and sends the digest — the free CI is the "server".
 */

/** Public half of the VAPID pair; the private half lives only in the data repo's Action secrets. */
export const VAPID_PUBLIC_KEY =
  'BMGmNH6N9_AWl4HyjTmwbjSXsGdXxSBgs3DOTNFiUQOyHkeFCD4Z7nd8QjlKXNc8q-Y5Z55390wrNXYOSnalA1Q';

/** PushManager wants the key as raw bytes, not base64url. */
function applicationServerKey(): Uint8Array {
  const raw = atob(VAPID_PUBLIC_KEY.replace(/-/g, '+').replace(/_/g, '/'));
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

/** Ask permission (must be inside a user gesture) and subscribe this device. */
export async function subscribePush(): Promise<PushSubscription> {
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') throw new Error('notification permission was not granted');
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: applicationServerKey() as BufferSource,
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
