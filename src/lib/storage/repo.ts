/**
 * Persistence gateway — the ONLY way the app touches IndexedDB.
 *
 * Invariants this layer owns (the future sync layer depends on them):
 * - every create stamps id/createdAt/updatedAt, every write re-stamps updatedAt
 * - deletes are tombstones (`deleted: true`), never physical removals
 * - reads via loadState() exclude tombstones
 */
import { nanoid } from 'nanoid';
import {
  DEFAULT_SETTINGS,
  type CurrentTaskRef, type List, type RecurrenceTemplate, type Settings,
  type Tag, type Task, type TaskDraft,
} from '../domain/types';
import type { DelightProgress, RemoteSnapshot } from '../sync/files';
import type { SyncConfig } from '../sync/githubClient';
import { mergeDelight, supersedes } from '../sync/merge';
import type { AppDb } from './db';

/** The parts of the stored delight blob the repo needs to see. */
interface StoredDelight {
  unlocks?: string[];
  storyStage?: number;
  trivia?: { correct: number; total: number };
  streakDays?: number;
  lastCompletionDay?: string;
  [key: string]: unknown;
}

/** The travelling half of the stored delight blob — the rest is device pacing. */
function storedToProgress(stored: StoredDelight): DelightProgress {
  return {
    unlocks: [...(stored.unlocks ?? [])],
    storyStage: stored.storyStage ?? 0,
    triviaCorrect: stored.trivia?.correct ?? 0,
    triviaTotal: stored.trivia?.total ?? 0,
    streakDays: stored.streakDays ?? 0,
    lastCompletionDay: stored.lastCompletionDay ?? '',
  };
}

export interface AppState {
  lists: List[];
  tasks: Task[];
  tags: Tag[];
  templates: RecurrenceTemplate[];
  currentTask: CurrentTaskRef | null;
  /** When currentTask last changed — the sync merge key for the singleton. 0 = never/legacy. */
  currentTaskUpdatedAt: number;
  settings: Settings;
  /** When settings last changed — sync merge key. 0 = never/legacy. */
  settingsUpdatedAt: number;
}

/** kv rows wrap their payload with a stamp since Phase 6; legacy rows are bare payloads. */
type StampedKv<T> = { data: T; updatedAt: number };

function readStamped<T>(raw: unknown, isLegacy: (v: unknown) => boolean): { data: T | undefined; updatedAt: number } {
  if (raw === undefined || raw === null) return { data: raw as T | undefined, updatedAt: 0 };
  if (typeof raw === 'object' && 'data' in (raw as object) && 'updatedAt' in (raw as object)) {
    const s = raw as StampedKv<T>;
    return { data: s.data, updatedAt: s.updatedAt };
  }
  return isLegacy(raw) ? { data: raw as T, updatedAt: 0 } : { data: undefined, updatedAt: 0 };
}

/** Base fields for a new row. Date.now() (not an injected clock) so vi.setSystemTime works. */
function stamp(): { id: string; createdAt: number; updatedAt: number; deleted: false } {
  const now = Date.now();
  return { id: nanoid(), createdAt: now, updatedAt: now, deleted: false };
}

export class Repo {
  constructor(private db: AppDb) {}

  async loadState(): Promise<AppState> {
    const [lists, tasks, tags, templates, currentRow, settingsRow] = await Promise.all([
      this.db.lists.toArray(), this.db.tasks.toArray(), this.db.tags.toArray(),
      this.db.templates.toArray(), this.db.kv.get('currentTask'), this.db.kv.get('settings'),
    ]);
    const live = <T extends { deleted: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted);
    const current = readStamped<CurrentTaskRef | null>(currentRow?.value, (v) =>
      v === null || (typeof v === 'object' && 'taskId' in (v as object)));
    const settings = readStamped<Partial<Settings>>(settingsRow?.value, (v) =>
      typeof v === 'object' && !('data' in (v as object)));
    return {
      lists: live(lists), tasks: live(tasks), tags: live(tags), templates: live(templates),
      currentTask: current.data ?? null,
      currentTaskUpdatedAt: current.updatedAt,
      settings: { ...DEFAULT_SETTINGS, ...(settings.data ?? {}) },
      settingsUpdatedAt: settings.updatedAt,
    };
  }

  async createList(fields: { title: string; areaGroup?: string }): Promise<List> {
    const row: List = { ...stamp(), sortMode: 'priority', ...fields };
    await this.db.lists.put(row);
    return row;
  }

  async createTask(draft: TaskDraft): Promise<Task> {
    const row: Task = { ...stamp(), ...draft };
    await this.db.tasks.put(row);
    return row;
  }

  async createTag(fields: { name: string; colorIndex: number }): Promise<Tag> {
    const row: Tag = { ...stamp(), ...fields };
    await this.db.tags.put(row);
    return row;
  }

  async createTemplate(
    fields: Omit<RecurrenceTemplate, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>,
  ): Promise<RecurrenceTemplate> {
    const row: RecurrenceTemplate = { ...stamp(), ...fields };
    await this.db.templates.put(row);
    return row;
  }

  /**
   * Read-modify-put rather than Dexie's update(): put() replaces the whole object,
   * which is the only reliable way to CLEAR optional keys (e.g. nextSpawnAt:
   * undefined) — update() semantics around undefined vary.
   */
  private async patchRow<T extends { id: string; updatedAt: number }>(
    table: { get: (id: string) => Promise<T | undefined>; put: (row: T) => Promise<string> },
    id: string,
    patch: Partial<T>,
  ): Promise<void> {
    const row = await table.get(id);
    if (!row) return;
    await table.put({ ...row, ...patch, updatedAt: Date.now() });
  }

  updateTask(id: string, patch: Partial<Task>) { return this.patchRow(this.db.tasks, id, patch); }
  updateList(id: string, patch: Partial<List>) { return this.patchRow(this.db.lists, id, patch); }
  updateTag(id: string, patch: Partial<Tag>) { return this.patchRow(this.db.tags, id, patch); }
  updateTemplate(id: string, patch: Partial<RecurrenceTemplate>) { return this.patchRow(this.db.templates, id, patch); }

  async softDelete(table: 'lists' | 'tasks' | 'tags' | 'templates', id: string): Promise<void> {
    // Switch narrows the table union — a computed this.db[table] can't type-check.
    switch (table) {
      case 'lists': return this.patchRow(this.db.lists, id, { deleted: true });
      case 'tasks': return this.patchRow(this.db.tasks, id, { deleted: true });
      case 'tags': return this.patchRow(this.db.tags, id, { deleted: true });
      case 'templates': return this.patchRow(this.db.templates, id, { deleted: true });
    }
  }

  async setCurrentTask(ref: CurrentTaskRef | null): Promise<void> {
    await this.db.kv.put({ key: 'currentTask', value: { data: ref, updatedAt: Date.now() } });
  }

  async getSettings(): Promise<Settings> {
    const row = await this.db.kv.get('settings');
    const parsed = readStamped<Partial<Settings>>(row?.value, (v) =>
      typeof v === 'object' && v !== null && !('data' in (v as object)));
    return { ...DEFAULT_SETTINGS, ...(parsed.data ?? {}) };
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const current = await this.getSettings();
    await this.db.kv.put({
      key: 'settings',
      value: { data: { ...current, ...patch }, updatedAt: Date.now() },
    });
  }

  // ── sync support (spec §8) ───────────────────────────────────────────────

  /** Full store INCLUDING tombstones — what the sync merge operates on. */
  async loadSnapshot(): Promise<RemoteSnapshot> {
    const state = await this.loadState();
    const [lists, tasks, tags, templates, eggs] = await Promise.all([
      this.db.lists.toArray(), this.db.tasks.toArray(),
      this.db.tags.toArray(), this.db.templates.toArray(),
      this.getKv<StoredDelight>('eggState'),
    ]);
    // Only the achievement half travels. The rest of eggState is pacing — what
    // has been shown lately, the quiet-time clock — which describes this device
    // and would gag another one if it were shared.
    const delight: DelightProgress | undefined = eggs ? storedToProgress(eggs) : undefined;
    return { ...state, lists, tasks, tags, templates, ...(delight ? { delight } : {}) };
  }

  /**
   * Write a merged snapshot back — one transaction, all-or-nothing.
   *
   * Deliberately NOT a wholesale swap. The snapshot was read before the sync
   * went to the network, and with a large library that round trip takes
   * seconds; anything the user did in the meantime is newer than what this
   * snapshot holds. Clearing the tables and re-writing it verbatim undid that
   * work — a list deleted mid-sync came back, a task ticked off mid-sync came
   * back unfinished — and, because the tombstone was destroyed rather than
   * overruled, the delete could never propagate either.
   *
   * So every row re-runs the merge's own newest-wins rule against whatever is
   * in storage at write time, and rows created since the read are left alone
   * (absent from the snapshot is exactly how the merge already treats a row
   * only one side knows about). That makes this write idempotent and
   * order-independent, which is what a background sync needs it to be.
   */
  async replaceAll(snap: RemoteSnapshot): Promise<void> {
    await this.db.transaction('rw', [this.db.lists, this.db.tasks, this.db.tags, this.db.templates, this.db.kv], async () => {
      await Promise.all([
        this.applyRows(this.db.lists, snap.lists),
        this.applyRows(this.db.tasks, snap.tasks),
        this.applyRows(this.db.tags, snap.tags),
        this.applyRows(this.db.templates, snap.templates),
        this.applyStamped('currentTask', snap.currentTask, snap.currentTaskUpdatedAt),
        this.applyStamped('settings', snap.settings, snap.settingsUpdatedAt),
      ]);
      // Merge the achievement half back in WITHOUT touching this device's
      // pacing fields (seen / lastPresentedAt / presentedToday). Read-modify-
      // write inside the same transaction so a concurrent save cannot lose it,
      // and by union/max so a discovery earned mid-sync is not erased either.
      if (snap.delight) {
        const row = await this.db.kv.get('eggState');
        const current = (row?.value as StoredDelight | undefined) ?? {};
        const won = mergeDelight(storedToProgress(current), snap.delight)!;
        await this.db.kv.put({
          key: 'eggState',
          value: {
            ...current,
            unlocks: won.unlocks,
            storyStage: won.storyStage,
            trivia: { correct: won.triviaCorrect, total: won.triviaTotal },
            streakDays: won.streakDays,
            lastCompletionDay: won.lastCompletionDay,
          },
        });
      }
    });
  }

  /** Write only the incoming rows that beat what storage already holds. */
  private async applyRows<T extends { id: string; updatedAt: number; deleted: boolean }>(
    table: { toArray: () => Promise<T[]>; bulkPut: (rows: T[]) => Promise<unknown> },
    incoming: T[],
  ): Promise<void> {
    const mine = new Map((await table.toArray()).map((row) => [row.id, row]));
    const wins = incoming.filter((row) => {
      const existing = mine.get(row.id);
      return existing === undefined || supersedes(row, existing);
    });
    if (wins.length) await table.bulkPut(wins);
  }

  /**
   * Same guard for the stamped singletons. `>=` rather than `>` so a merge that
   * simply agrees with what is stored still rewrites it — only a strictly newer
   * local change wins.
   */
  private async applyStamped(key: 'currentTask' | 'settings', data: unknown, updatedAt: number): Promise<void> {
    const row = await this.db.kv.get(key);
    const value = row?.value;
    const stored = typeof value === 'object' && value !== null && 'updatedAt' in value
      ? (value as { updatedAt: number }).updatedAt
      : 0;
    if (updatedAt >= stored) await this.db.kv.put({ key, value: { data, updatedAt } });
  }

  /** Generic device-local kv (delight state etc.) — not part of sync snapshots. */
  async getKv<T>(key: string): Promise<T | null> {
    const row = await this.db.kv.get(key);
    return (row?.value as T | undefined) ?? null;
  }

  async setKv<T>(key: string, value: T): Promise<void> {
    await this.db.kv.put({ key, value });
  }

  /** Device-local sync credentials — NEVER part of snapshots or synced files. */
  async getSyncAuth(): Promise<SyncConfig | null> {
    const row = await this.db.kv.get('syncAuth');
    return (row?.value as SyncConfig | undefined) ?? null;
  }

  async setSyncAuth(cfg: SyncConfig): Promise<void> {
    await this.db.kv.put({ key: 'syncAuth', value: cfg });
  }

  async clearSyncAuth(): Promise<void> {
    await this.db.kv.delete('syncAuth');
  }
}
