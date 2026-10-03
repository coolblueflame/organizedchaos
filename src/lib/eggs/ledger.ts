/**
 * Choices kept in the delight ledger (DelightProgress.marks).
 *
 * The ledger only ever keeps the larger value per key, so a choice that can
 * change ("which trinket", "seasonal touches on or off") is stored as one
 * key per option, each stamped with the moment it was chosen: choosing is
 * stamping now, and the current choice is the newest stamp. Two devices that
 * chose differently agree on whichever chose last, and no write can ever
 * take a choice back to an older one.
 */

/** The option chosen most recently under `prefix` (the key minus the prefix), or null if none was. */
export function latestChoice(marks: Readonly<Record<string, number>>, prefix: string): string | null {
  let newest: string | null = null;
  let at = -Infinity;
  for (const [key, stamp] of Object.entries(marks)) {
    if (!key.startsWith(prefix) || stamp <= at) continue;
    newest = key.slice(prefix.length);
    at = stamp;
  }
  return newest;
}
