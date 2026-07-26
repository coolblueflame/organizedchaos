/**
 * Entity-level newest-wins merge (spec §8). No field-level merging: per id, the
 * version with the larger `updatedAt` wins wholesale; ties prefer the
 * tombstoned/completed side (deterministic, biased toward "done"). Entities
 * present on only one side always survive — that's how both adds AND deletes
 * (tombstones) propagate. Singletons (currentTask, settings) merge by their
 * kv stamps, so clearing the current task on one device propagates too.
 */
import type { RemoteSnapshot } from './files';

export interface MergeResult {
  merged: RemoteSnapshot;
  /** merged differs from `local` → caller must persist locally */
  localChanged: boolean;
  /** merged differs from `remote` → caller must push */
  remoteChanged: boolean;
}

interface Row { id: string; updatedAt: number; deleted: boolean }

function pick<T extends Row>(a: T, b: T): T {
  if (a.updatedAt !== b.updatedAt) return a.updatedAt > b.updatedAt ? a : b;
  if (a.deleted !== b.deleted) return a.deleted ? a : b;
  // Same stamp, same tombstone state: sides are equivalent for our purposes.
  return a;
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

/** Order-insensitive deep comparison of two row sets. */
function sameRows<T extends Row>(a: T[], b: T[]): boolean {
  if (a.length !== b.length) return false;
  const byId = new Map(a.map((r) => [r.id, r]));
  return b.every((r) => {
    const match = byId.get(r.id);
    return match !== undefined && JSON.stringify(match) === JSON.stringify(r);
  });
}

export function mergeSnapshots(local: RemoteSnapshot, remote: RemoteSnapshot): MergeResult {
  const currentNewer = remote.currentTaskUpdatedAt > local.currentTaskUpdatedAt ? remote : local;
  const settingsNewer = remote.settingsUpdatedAt > local.settingsUpdatedAt ? remote : local;

  const merged: RemoteSnapshot = {
    lists: mergeRows(local.lists, remote.lists),
    tasks: mergeRows(local.tasks, remote.tasks),
    tags: mergeRows(local.tags, remote.tags),
    templates: mergeRows(local.templates, remote.templates),
    currentTask: currentNewer.currentTask,
    currentTaskUpdatedAt: currentNewer.currentTaskUpdatedAt,
    settings: settingsNewer.settings,
    settingsUpdatedAt: settingsNewer.settingsUpdatedAt,
  };

  const sameAs = (side: RemoteSnapshot) =>
    sameRows(merged.lists, side.lists) &&
    sameRows(merged.tasks, side.tasks) &&
    sameRows(merged.tags, side.tags) &&
    sameRows(merged.templates, side.templates) &&
    JSON.stringify(merged.currentTask) === JSON.stringify(side.currentTask) &&
    merged.currentTaskUpdatedAt === side.currentTaskUpdatedAt &&
    JSON.stringify(merged.settings) === JSON.stringify(side.settings) &&
    merged.settingsUpdatedAt === side.settingsUpdatedAt;

  return { merged, localChanged: !sameAs(local), remoteChanged: !sameAs(remote) };
}
