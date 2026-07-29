/**
 * Entity-level newest-wins merge (spec §8). No field-level merging: per id, the
 * version with the larger `updatedAt` wins wholesale; ties prefer the
 * tombstoned/completed side (deterministic, biased toward "done"). Entities
 * present on only one side always survive — that's how both adds AND deletes
 * (tombstones) propagate. Singletons (currentTask, settings) merge by their
 * kv stamps, so clearing the current task on one device propagates too.
 */
import type { DelightProgress, RemoteSnapshot } from './files';

export interface MergeResult {
  merged: RemoteSnapshot;
  /** merged differs from `local` → caller must persist locally */
  localChanged: boolean;
  /** merged differs from `remote` → caller must push */
  remoteChanged: boolean;
}

interface Row { id: string; updatedAt: number; deleted: boolean; editedAt?: number }

/**
 * Order-independent serialisation, so two copies of a row compare equal
 * whichever way their keys happen to be laid out — one side has come back from
 * IndexedDB and the other from JSON, and neither guarantees key order.
 */
function canonical(v: unknown): string {
  if (v === null || typeof v !== 'object') return JSON.stringify(v) ?? 'null';
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  return `{${Object.entries(v as Record<string, unknown>)
    .filter(([, val]) => val !== undefined)
    .sort(([x], [y]) => (x < y ? -1 : 1))
    .map(([k, val]) => `${JSON.stringify(k)}:${canonical(val)}`)
    .join(',')}}`;
}

function pick<T extends Row>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.deleted !== b.deleted) return a.deleted ? a : b;
  // The honest clock breaks the tie before the arbitrary one does. Ties are
  // ROUTINE for rows that came through the import-timestamp repair: their
  // merge keys sit decades ahead, so every edit clamps to current+1 and two
  // devices editing from the same base collide exactly. editedAt is real
  // wall-clock, so the genuinely later edit wins; a side that has one beats a
  // side that lacks one (it was written by code that stamps it, i.e. later).
  const ea = a.editedAt ?? 0;
  const eb = b.editedAt ?? 0;
  if (ea !== eb) return ea > eb ? a : b;
  // Same stamp, same tombstone state, but the contents can still differ — and
  // that happens far more readily than it used to. A write clamps to
  // `max(now, current + 1)`, so two devices editing one row while offline both
  // land on exactly that, where before they would have differed by whatever
  // milliseconds separated them.
  //
  // Preferring "mine" would leave each device convinced it was right, holding
  // different content under the same stamp with nothing left to break the deadlock:
  // the disagreement would be permanent rather than merely arbitrary. So the tie
  // breaks on the content itself, which both sides can evaluate identically.
  // Which one wins is arbitrary; that they agree is the whole point.
  const [ca, cb] = [canonical(a), canonical(b)];
  return ca <= cb ? a : b;
}

/**
 * Does `incoming` beat the copy already in storage?
 *
 * The same rule `pick` uses, exposed so the write-back can re-apply it at the
 * moment it touches the database. A sync cycle merges against a snapshot read
 * seconds earlier; re-checking here is what stops it from carrying a row the
 * user has since changed — or deleted — back into storage.
 */
export function supersedes(incoming: Row, mine: Row): boolean {
  return pick(mine, incoming) === incoming;
}

function mergeRows<T extends Row>(local: T[], remote: T[]): T[] {
  const byId = new Map<string, T>();
  for (const row of local) byId.set(row.id, row);
  for (const row of remote) {
    const existing = byId.get(row.id);
    byId.set(row.id, existing ? pick(existing, row) : row);
  }
  return [...byId.values()];
}

/**
 * Order-insensitive deep comparison of two row sets — insensitive to the order
 * of the KEYS as well as of the rows, since "has this changed" should be a
 * question about content, not about how the object happens to be laid out. One
 * side has come back from IndexedDB and the other from JSON; treating a
 * difference in key order as a change would push a byte-for-byte pointless file.
 */
function sameRows<T extends Row>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((r) => [r.id, r]));
  return b.every((r) => {
    const match = byId.get(r.id);
    return match !== undefined && canonical(match) === canonical(r);
  });
}

/**
 * Achievements merge by union and maximum, never by "newest wins".
 *
 * A discovery earned on one device is earned, full stop — last-write-wins
 * would let a phone that had not seen it yet erase it from the laptop. Union
 * and max are also idempotent and order-independent, so merging twice, or in
 * the other order, lands in the same place.
 *
 * The streak is the exception that needs a key: it is a single number whose
 * meaning depends on when it was last touched, so the side that completed
 * something more recently wins, with the larger streak breaking a tie.
 */
export function mergeDelight(
  a: DelightProgress | undefined,
  b: DelightProgress | undefined,
): DelightProgress | undefined {
  if (!a) return b;
  if (!b) return a;
  const streakSide =
    a.lastCompletionDay === b.lastCompletionDay
      ? (a.streakDays >= b.streakDays ? a : b)
      : (a.lastCompletionDay > b.lastCompletionDay ? a : b);
  return {
    unlocks: [...new Set([...a.unlocks, ...b.unlocks])].sort(),
    storyStage: Math.max(a.storyStage, b.storyStage),
    triviaCorrect: Math.max(a.triviaCorrect, b.triviaCorrect),
    triviaTotal: Math.max(a.triviaTotal, b.triviaTotal),
    streakDays: streakSide.streakDays,
    lastCompletionDay: streakSide.lastCompletionDay,
    // The record is a plain maximum; a side that predates the field reports
    // its current streak as the floor, so old builds can't erase the record.
    bestStreakDays: Math.max(a.bestStreakDays ?? a.streakDays, b.bestStreakDays ?? b.streakDays),
  };
}

/**
 * Newest-wins for a stamped singleton, with the same content tiebreak rows
 * get: an exact stamp tie sent each device to its OWN copy, so two devices
 * that collided (routine under clamped stamps) pushed A/B/A forever and the
 * queue order never settled. Both sides now deterministically pick the same
 * winner. Symmetric by construction — the comparison ignores which side is
 * "local".
 */
function pickSingleton<V>(a: V, aStamp: number, b: V, bStamp: number): [V, number] {
  if (aStamp !== bStamp) return aStamp > bStamp ? [a, aStamp] : [b, bStamp];
  return canonical(a) <= canonical(b) ? [a, aStamp] : [b, bStamp];
}

export function mergeSnapshots(local: RemoteSnapshot, remote: RemoteSnapshot): MergeResult {
  const [currentTask, currentTaskUpdatedAt] = pickSingleton(
    local.currentTask, local.currentTaskUpdatedAt, remote.currentTask, remote.currentTaskUpdatedAt);
  const [settings, settingsUpdatedAt] = pickSingleton(
    local.settings, local.settingsUpdatedAt, remote.settings, remote.settingsUpdatedAt);
  const [queueIds, queueUpdatedAt] = pickSingleton(
    local.queueIds, local.queueUpdatedAt, remote.queueIds, remote.queueUpdatedAt);

  const delight = mergeDelight(local.delight, remote.delight);

  const merged: RemoteSnapshot = {
    lists: mergeRows(local.lists, remote.lists),
    tasks: mergeRows(local.tasks, remote.tasks),
    tags: mergeRows(local.tags, remote.tags),
    templates: mergeRows(local.templates, remote.templates),
    currentTask,
    currentTaskUpdatedAt,
    settings,
    settingsUpdatedAt,
    queueIds,
    queueUpdatedAt,
    ...(delight ? { delight } : {}),
  };

  const sameAs = (side: RemoteSnapshot) =>
    sameRows(merged.lists, side.lists) &&
    sameRows(merged.tasks, side.tasks) &&
    sameRows(merged.tags, side.tags) &&
    sameRows(merged.templates, side.templates) &&
    JSON.stringify(merged.currentTask) === JSON.stringify(side.currentTask) &&
    merged.currentTaskUpdatedAt === side.currentTaskUpdatedAt &&
    JSON.stringify(merged.settings) === JSON.stringify(side.settings) &&
    merged.settingsUpdatedAt === side.settingsUpdatedAt &&
    JSON.stringify(merged.queueIds) === JSON.stringify(side.queueIds) &&
    merged.queueUpdatedAt === side.queueUpdatedAt &&
    JSON.stringify(merged.delight ?? null) === JSON.stringify(side.delight ?? null);

  return { merged, localChanged: !sameAs(local), remoteChanged: !sameAs(remote) };
}
