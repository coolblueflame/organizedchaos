/**
 * Sync file serialization (spec §8). The remote repo holds:
 *   active.json            — lists/tags/templates, currentTask, settings, queue (+stamps)
 *   tasks-<0..15>.json     — OPEN tasks, spread by a hash of their id
 *   logbook-<year>-<0..7>.json — completed tasks, by completion year then the same hash
 *   meta.json              — { schema } version gate
 *
 * The sharding exists because the Contents API can only replace a file whole:
 * see TASK_SHARDS below for the measurement that prompted it.
 * Tombstones older than 90 days are compacted away here (spec §3).
 */
import type {
  CurrentTaskRef, List, RecurrenceTemplate, Settings, Tag, Task,
} from '../domain/types';
import type { BurdenLedger } from '../domain/stats';

/**
 * 2 (2026-08-03): open tasks moved out of active.json into `tasks-<n>.json`
 * shards and the logbook gained per-year buckets, so an edit no longer
 * rewrites the whole library. Bumped deliberately: a device still running v1
 * would otherwise read the new layout as "no open tasks" and push its own
 * copies back in the old shape, and the two would rewrite each other forever.
 * The version gate turns that into a loud, harmless "update the app" instead.
 */
export const SCHEMA_VERSION = 2;
const TOMBSTONE_TTL_MS = 90 * 86_400_000;

/** Thrown when the remote was written by a NEWER app version — never clobber it. */
export class SchemaTooNewError extends Error {
  constructor(found: number) {
    super(`Remote schema v${found} is newer than this app understands (v${SCHEMA_VERSION}). Update the app.`);
  }
}

/**
 * The half of the delight state that belongs to the USER rather than the
 * device: what they have discovered, how far the story has come, their quiz
 * record, their streak.
 *
 * The other half — which entries have been seen lately, the quiet-time clock,
 * today's per-event tallies — is pacing, and deliberately stays device-local.
 * Syncing that would let one device's recent surprise suppress another's.
 *
 * Optional on the wire: remotes written before this existed simply lack it.
 */
export interface DelightProgress {
  unlocks: string[];
  storyStage: number;
  triviaCorrect: number;
  triviaTotal: number;
  streakDays: number;
  /** App-day key of the most recent completion — the streak's merge key. */
  lastCompletionDay: string;
  /** High-water mark of the streak. Absent on remotes written before it existed. */
  bestStreakDays?: number;
  /**
   * Per-unlock ownership clocks (unlock id → ms timestamp), present only once
   * something needed one. `unlocks` stays the held set so older builds keep
   * working; these maps exist because the union merge alone can never TAKE
   * BACK a discovery — an accidental mass-completion granted one that was
   * never earned (2026-08-12), and every device kept restoring it.
   *
   * Rule, per id: the newest of grant vs revoke wins. A held unlock with no
   * grant entry counts as granted at epoch 0, so any real revocation beats
   * it — while a genuine later re-earn is stamped with a fresh grant, which
   * beats the old revocation. See resolveHeldUnlocks.
   */
  unlockGrants?: Record<string, number>;
  unlockRevokes?: Record<string, number>;
}

/**
 * Which unlocks are actually held once the ownership clocks have their say.
 * `unlocks` are the claimed ids (a legacy claim = granted at 0); ids that only
 * appear in `grants` count too, so a re-earned unlock survives a merge with a
 * side that had already dropped it from its array. Sorted for canonical order.
 */
export function resolveHeldUnlocks(
  unlocks: string[],
  grants: Record<string, number> = {},
  revokes: Record<string, number> = {},
): string[] {
  const claimed = new Set([...unlocks, ...Object.keys(grants)]);
  return [...claimed].filter((id) => {
    const grantedAt = grants[id] ?? (unlocks.includes(id) ? 0 : undefined);
    if (grantedAt === undefined) return false;
    const revokedAt = revokes[id];
    return revokedAt === undefined || grantedAt > revokedAt;
  }).sort();
}

export interface RemoteSnapshot {
  lists: List[];
  tasks: Task[];
  tags: Tag[];
  templates: RecurrenceTemplate[];
  currentTask: CurrentTaskRef | null;
  currentTaskUpdatedAt: number;
  /**
   * SPARSE — only what the user explicitly set. Materializing DEFAULT_SETTINGS
   * into this blob froze the defaults of whatever app version wrote it: a
   * device that never touched a setting would push today's default as if it
   * were a choice, and a future release changing a default could never reach
   * anyone. Defaults are applied at the read edge (repo.getSettings/loadState).
   */
  settings: Partial<Settings>;
  settingsUpdatedAt: number;
  /** The day queue (ordered task ids) — a stamped singleton like settings. */
  queueIds: string[];
  queueUpdatedAt: number;
  delight?: DelightProgress;
  /**
   * Daily backlog measurements (see domain/stats.BurdenLedger). Not a stamped
   * singleton: days merge independently, earliest measurement per day wins.
   * Absent on remotes written before it existed.
   */
  burdenLedger?: BurdenLedger;
}

export interface SyncFilePayloads {
  [path: string]: unknown;
}

interface ActiveFile {
  schema: number;
  lists: List[];
  /** v1 only: open tasks lived here before they were sharded out (see toFiles). */
  tasks?: Task[];
  tags: Tag[];
  templates: RecurrenceTemplate[];
  currentTask: CurrentTaskRef | null;
  currentTaskUpdatedAt: number;
  /** Sparse; see RemoteSnapshot.settings. Older remotes hold materialized blobs. */
  settings: Partial<Settings>;
  settingsUpdatedAt: number;
  /** Optional on the wire: remotes written before the queue existed lack them. */
  queueIds?: string[];
  queueUpdatedAt?: number;
  delight?: DelightProgress;
  burdenLedger?: BurdenLedger;
}

interface LogbookFile {
  schema: number;
  tasks: Task[];
}

/**
 * How many files the task rows are spread across.
 *
 * The Contents API has no partial update: changing one byte of a file means
 * PUTting the whole thing. With every open task in one active.json, ticking a
 * single checkbox uploaded the entire library — measured at 1.5MB per sync
 * against a real 2,500-task account, which is a genuine cost on cellular
 * (reported 2026-08-03). Spreading rows over N files means an edit rewrites
 * only the file its row lives in.
 *
 * The counts are a balance: more shards means smaller writes but more paths in
 * every listing. 16 open-task shards put a single edit around 90KB, and 8 per
 * logbook year keeps a completion in the same range without turning a decade
 * of history into hundreds of files.
 */
const TASK_SHARDS = 16;
const LOGBOOK_SHARDS = 8;

/**
 * Which shard a row belongs to — FNV-1a over the id.
 *
 * Must be pure and stable forever: every device has to compute the same bucket
 * for the same row, or two of them will write the same task into different
 * files and each will keep "restoring" it to the other's shard.
 */
export function shardOf(id: string, buckets: number): number {
  let h = 2166136261;
  for (let i = 0; i < id.length; i += 1) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) % buckets;
}

const notStale = (now: Date) => <T extends { deleted: boolean; updatedAt: number }>(row: T) =>
  !row.deleted || now.getTime() - row.updatedAt < TOMBSTONE_TTL_MS;

export function toFiles(snap: RemoteSnapshot, now: Date): SyncFilePayloads {
  const keep = notStale(now);
  const tasks = snap.tasks.filter(keep);
  const open = tasks.filter((t) => t.completedAt === undefined);
  const completed = tasks.filter((t) => t.completedAt !== undefined);

  const files: SyncFilePayloads = {};
  const active: ActiveFile = {
    schema: SCHEMA_VERSION,
    lists: snap.lists.filter(keep),
    tags: snap.tags.filter(keep),
    templates: snap.templates.filter(keep),
    currentTask: snap.currentTask,
    currentTaskUpdatedAt: snap.currentTaskUpdatedAt,
    settings: snap.settings,
    settingsUpdatedAt: snap.settingsUpdatedAt,
    queueIds: snap.queueIds,
    queueUpdatedAt: snap.queueUpdatedAt,
    ...(snap.delight ? { delight: snap.delight } : {}),
    ...(snap.burdenLedger && Object.keys(snap.burdenLedger).length
      ? { burdenLedger: snap.burdenLedger } : {}),
  };
  files['active.json'] = active;

  // Every shard is emitted even when empty, so a row LEAVING one is a change
  // the other devices actually see. (The engine skips writing files whose
  // content is byte-identical, so empty shards cost nothing after the first.)
  const openShards: Task[][] = Array.from({ length: TASK_SHARDS }, () => []);
  for (const t of open) openShards[shardOf(t.id, TASK_SHARDS)]!.push(t);
  openShards.forEach((bucket, i) => {
    files[`tasks-${i}.json`] = { schema: SCHEMA_VERSION, tasks: bucket } satisfies LogbookFile;
  });

  const byYearShard = new Map<string, Task[]>();
  for (const t of completed) {
    const year = new Date(t.completedAt!).getFullYear();
    const key = `${year}-${shardOf(t.id, LOGBOOK_SHARDS)}`;
    const bucket = byYearShard.get(key) ?? [];
    bucket.push(t);
    byYearShard.set(key, bucket);
  }
  for (const [key, bucket] of byYearShard) {
    files[`logbook-${key}.json`] = { schema: SCHEMA_VERSION, tasks: bucket } satisfies LogbookFile;
  }

  files['meta.json'] = { schema: SCHEMA_VERSION };
  return files;
}

export function fromFiles(files: SyncFilePayloads): RemoteSnapshot {
  const meta = files['meta.json'] as { schema?: number } | undefined;
  if (meta?.schema !== undefined && meta.schema > SCHEMA_VERSION) throw new SchemaTooNewError(meta.schema);

  const active = (files['active.json'] as Partial<ActiveFile> | undefined) ?? {};
  if (active.schema !== undefined && active.schema > SCHEMA_VERSION) throw new SchemaTooNewError(active.schema);

  /*
    Rows come from three places: the shard files, the logbook files, and —
    for a remote last written before sharding — active.json's own `tasks`.
    Reading all three is what makes the migration a non-event in both
    directions: a v1 remote still loads, and a half-migrated one (old
    logbook-<year>.json not yet emptied while its buckets already exist)
    can hold the same row twice, so the union dedupes by id rather than
    trusting the files to be disjoint.
  */
  const byId = new Map<string, Task>();
  const absorb = (rows: Task[] | undefined) => {
    for (const row of rows ?? []) {
      const seen = byId.get(row.id);
      if (!seen || row.updatedAt > seen.updatedAt) byId.set(row.id, row);
    }
  };
  absorb(active.tasks);
  for (const [path, payload] of Object.entries(files)) {
    if (!path.startsWith('logbook-') && !path.startsWith('tasks-')) continue;
    const shard = payload as Partial<LogbookFile>;
    if (shard.schema !== undefined && shard.schema > SCHEMA_VERSION) throw new SchemaTooNewError(shard.schema);
    absorb(shard.tasks);
  }
  const tasks: Task[] = [...byId.values()];

  return {
    lists: active.lists ?? [],
    tasks,
    tags: active.tags ?? [],
    templates: active.templates ?? [],
    currentTask: active.currentTask ?? null,
    currentTaskUpdatedAt: active.currentTaskUpdatedAt ?? 0,
    settings: active.settings ?? {},
    settingsUpdatedAt: active.settingsUpdatedAt ?? 0,
    // Pre-queue remotes report an empty queue at stamp 0, which always loses.
    queueIds: active.queueIds ?? [],
    queueUpdatedAt: active.queueUpdatedAt ?? 0,
    // Absent on remotes written before delight synced — merge treats it as none.
    ...(active.delight ? { delight: active.delight } : {}),
    ...(active.burdenLedger ? { burdenLedger: active.burdenLedger } : {}),
  };
}
