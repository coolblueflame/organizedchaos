/**
 * How many draws each chance-mode template has sat through since its task
 * last completed — the "+N% per roll" half of the pepper mechanic
 * (2026-08-20 ask; see RecurrenceMode kind 'chance').
 *
 * DEVICE-LOCAL on purpose, same doctrine as the delight engine's pacing:
 * rolls happen constantly, and syncing a counter write per roll would churn
 * active.json for a number that is about this device's session texture, not
 * the user's data. Two devices each grow their own chance; completion (which
 * IS synced) resets the mechanic's real state everywhere.
 */

const KEY = 'oc-pepper-rolls';

let cache: Record<string, number> | null = null;

function load(): Record<string, number> {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>;
  } catch {
    cache = {};
  }
  return cache;
}

function save(): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(cache ?? {}));
  } catch { /* storage full/blocked — the counter is a nicety, never fatal */ }
}

export function pepperRollsFor(templateId: string): number {
  return load()[templateId] ?? 0;
}

/** Every draw that served a card ages every pepper by one roll. */
export function bumpPepperRolls(templateIds: string[]): void {
  if (templateIds.length === 0) return;
  const store = load();
  for (const id of templateIds) store[id] = (store[id] ?? 0) + 1;
  save();
}

/** Completion resets the climb — back to the base chance. */
export function resetPepperRolls(templateId: string): void {
  const store = load();
  if (store[templateId] === undefined) return;
  delete store[templateId];
  save();
}
