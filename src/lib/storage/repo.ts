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
import type { AppDb } from './db';

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
}
