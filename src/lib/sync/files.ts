/**
 * Sync file serialization (spec §8). The remote repo holds:
 *   active.json        — lists/tags/templates, OPEN tasks, currentTask, settings (+stamps)
 *   logbook-<year>.json — completed tasks bucketed by local completion year (append-mostly,
 *                         so the frequently-pushed active file stays small)
 *   meta.json          — { schema } version gate
 * Tombstones older than 90 days are compacted away here (spec §3).
 */
import {
  DEFAULT_SETTINGS,
  type CurrentTaskRef, type List, type RecurrenceTemplate, type Settings, type Tag, type Task,
} from '../domain/types';

export const SCHEMA_VERSION = 1;
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
}

export interface RemoteSnapshot {
  lists: List[];
  tasks: Task[];
  tags: Tag[];
  templates: RecurrenceTemplate[];
  currentTask: CurrentTaskRef | null;
  currentTaskUpdatedAt: number;
  settings: Settings;
  settingsUpdatedAt: number;
  /** The day queue (ordered task ids) — a stamped singleton like settings. */
  queueIds: string[];
  queueUpdatedAt: number;
  delight?: DelightProgress;
}

export interface SyncFilePayloads {
  [path: string]: unknown;
}

interface ActiveFile {
  schema: number;
  lists: List[];
  tasks: Task[];
  tags: Tag[];
  templates: RecurrenceTemplate[];
  currentTask: CurrentTaskRef | null;
  currentTaskUpdatedAt: number;
  settings: Settings;
  settingsUpdatedAt: number;
  /** Optional on the wire: remotes written before the queue existed lack them. */
  queueIds?: string[];
  queueUpdatedAt?: number;
  delight?: DelightProgress;
}

interface LogbookFile {
  schema: number;
  tasks: Task[];
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
    tasks: open,
    tags: snap.tags.filter(keep),
    templates: snap.templates.filter(keep),
    currentTask: snap.currentTask,
    currentTaskUpdatedAt: snap.currentTaskUpdatedAt,
    settings: snap.settings,
    settingsUpdatedAt: snap.settingsUpdatedAt,
    queueIds: snap.queueIds,
    queueUpdatedAt: snap.queueUpdatedAt,
    ...(snap.delight ? { delight: snap.delight } : {}),
  };
  files['active.json'] = active;

  const byYear = new Map<number, Task[]>();
  for (const t of completed) {
    const year = new Date(t.completedAt!).getFullYear();
    const bucket = byYear.get(year) ?? [];
    bucket.push(t);
    byYear.set(year, bucket);
  }
  for (const [year, bucket] of byYear) {
    files[`logbook-${year}.json`] = { schema: SCHEMA_VERSION, tasks: bucket } satisfies LogbookFile;
  }

  files['meta.json'] = { schema: SCHEMA_VERSION };
  return files;
}

export function fromFiles(files: SyncFilePayloads): RemoteSnapshot {
  const meta = files['meta.json'] as { schema?: number } | undefined;
  if (meta?.schema !== undefined && meta.schema > SCHEMA_VERSION) throw new SchemaTooNewError(meta.schema);

  const active = (files['active.json'] as Partial<ActiveFile> | undefined) ?? {};
  if (active.schema !== undefined && active.schema > SCHEMA_VERSION) throw new SchemaTooNewError(active.schema);

  const tasks: Task[] = [...(active.tasks ?? [])];
  for (const [path, payload] of Object.entries(files)) {
    if (!path.startsWith('logbook-')) continue;
    const logbook = payload as Partial<LogbookFile>;
    if (logbook.schema !== undefined && logbook.schema > SCHEMA_VERSION) throw new SchemaTooNewError(logbook.schema);
    tasks.push(...(logbook.tasks ?? []));
  }

  return {
    lists: active.lists ?? [],
    tasks,
    tags: active.tags ?? [],
    templates: active.templates ?? [],
    currentTask: active.currentTask ?? null,
    currentTaskUpdatedAt: active.currentTaskUpdatedAt ?? 0,
    settings: { ...DEFAULT_SETTINGS, ...(active.settings ?? {}) },
    settingsUpdatedAt: active.settingsUpdatedAt ?? 0,
    // Pre-queue remotes report an empty queue at stamp 0, which always loses.
    queueIds: active.queueIds ?? [],
    queueUpdatedAt: active.queueUpdatedAt ?? 0,
    // Absent on remotes written before delight synced — merge treats it as none.
    ...(active.delight ? { delight: active.delight } : {}),
  };
}
