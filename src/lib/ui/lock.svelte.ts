/**
 * PIN mechanics for locked lists — hashing, set, verify. The reactive session
 * flag itself lives in state/lockSession (the store's draw path reads it);
 * this module is the UI-facing face of the same thing.
 */
import { app } from '../state/app.svelte';
import { lockSession } from '../state/lockSession.svelte';

export const lock = lockSession;

const toHex = (buf: ArrayBuffer) =>
  [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function hashPin(pin: string, salt: string): Promise<string> {
  const data = new TextEncoder().encode(`${salt}:${pin}`);
  return toHex(await crypto.subtle.digest('SHA-256', data));
}

/** Set (or change) the PIN — stored as salt + hash in synced settings. */
export async function setPin(pin: string): Promise<void> {
  const salt = toHex(crypto.getRandomValues(new Uint8Array(16)).buffer);
  await app.updateSettings({ lockPin: { salt, hash: await hashPin(pin, salt) } });
  lock.unlocked = true; // whoever just set it has obviously proven themselves
}

/** True (and unlocks the session) when the PIN matches. */
export async function tryUnlock(pin: string): Promise<boolean> {
  const stored = app.state.settings.lockPin;
  if (!stored) return false;
  const ok = (await hashPin(pin, stored.salt)) === stored.hash;
  if (ok) lock.unlocked = true;
  return ok;
}

export const hasPin = (): boolean => app.state.settings.lockPin !== undefined;
