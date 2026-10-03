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

/**
 * The option chosen most recently under `prefix` (the key minus the
 * prefix), or null if none was. Equal stamps go to the larger key, so every
 * device settles a tie the same way whatever order its keys arrived in.
 */
export function latestChoice(marks: Readonly<Record<string, number>>, prefix: string): string | null {
  let newest: string | null = null;
  let at = -Infinity;
  for (const [key, stamp] of Object.entries(marks)) {
    if (!key.startsWith(prefix)) continue;
    const option = key.slice(prefix.length);
    if (stamp < at || (stamp === at && option < newest!)) continue;
    newest = option;
    at = stamp;
  }
  return newest;
}

/**
 * The stamp for a new choice under `prefix`: now, or one past the newest
 * stamp already there, whichever is later. A device whose clock runs behind
 * another's would otherwise stamp a fresh choice older than one it has
 * already seen, and the fresh choice would lose.
 */
export function choiceStamp(marks: Readonly<Record<string, number>>, prefix: string, now = Date.now()): number {
  let newest = 0;
  for (const [key, stamp] of Object.entries(marks)) if (key.startsWith(prefix)) newest = Math.max(newest, stamp);
  return Math.max(now, newest + 1);
}
