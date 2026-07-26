/**
 * The app's single state layer: a Svelte-5 runes mirror of AppState, with every
 * mutation flowing Repo-first (persist), then patching the mirror in place.
 * Screens import the `app` singleton and never touch Repo/Dexie directly.
 */
import {
  DEFAULT_SETTINGS,
  type List, type RecurrenceMode, type RecurrenceTemplate, type SortMode, type Tag, type Task,
} from '../domain/types';
import { nextRolloverTs } from '../domain/time';
import { nextScheduledSpawn, scheduleAfterCompletion, sweepSpawns } from '../domain/recurrence';
import { drawTask } from '../domain/randomizer';
import { SyncEngine, type SyncStatus } from '../sync/engine';
import { GithubClient } from '../sync/githubClient';
import { nanoid } from 'nanoid';
import type { MappedImport } from '../import/thingsMap';
import { EggEngine, type EggEvent, type EggState } from '../eggs/engine';
import { REGISTRY } from '../eggs/registry';
import { UNLOCKS } from '../eggs/content/extras';
import { presenter } from '../eggs/presenter.svelte';
import { completionCounts } from '../domain/stats';
import { openDb } from '../storage/db';
import { Repo, type AppState } from '../storage/repo';

export class AppStore {
  state: AppState = $state({
    lists: [], tasks: [], tags: [], templates: [],
    currentTask: null, currentTaskUpdatedAt: 0,
    settings: { ...DEFAULT_SETTINGS }, settingsUpdatedAt: 0,
  });
  ready = $state(false);
  /** navigator.storage.persist() outcome — surfaced in Settings (spec §2 hardening). */
  persistentStorage = $state<'granted' | 'denied' | 'unsupported' | 'unknown'>('unknown');
  syncStatus = $state<SyncStatus>('disabled');
  syncDetail = $state('');
  lastSyncAt = $state<number | null>(null);

  private repo!: Repo;
  private engine: SyncEngine | null = null;
  private eggs: EggEngine | null = null;
  /** Reactive mirrors of delight state the UI cares about. */
  eggStreak = $state(0);
  eggUnlocks = $state<string[]>([]);
  eggTrivia = $state({ correct: 0, total: 0 });
  /** Recently-removed rows kept for the undo toast's 5s window (session-only). */
  private trashTasks = new Map<string, Task>();
  private trashLists = new Map<string, List>();

  async init(dbName?: string): Promise<void> {
    this.repo = new Repo(openDb(dbName));
    const loaded = await this.repo.loadState();
    this.state.lists = loaded.lists;
    this.state.tasks = loaded.tasks;
    this.state.tags = loaded.tags;
    this.state.templates = loaded.templates;
    this.state.currentTask = loaded.currentTask;
    this.state.currentTaskUpdatedAt = loaded.currentTaskUpdatedAt;
    this.state.settings = loaded.settings;
    this.state.settingsUpdatedAt = loaded.settingsUpdatedAt;
    // Materialize any recurrences that came due while the app was closed.
    await this.runSpawnSweep();
    this.ready = true;
    // Resume sync if this device is connected; first pull runs behind the UI.
    const auth = await this.repo.getSyncAuth();
    if (auth) {
      this.buildEngine(auth);
      void this.engine!.syncNow();
    }
    // Ask the browser to exempt our storage from eviction (installed PWAs are
    // granted this on iOS — the belt to cloud-sync's suspenders).
    if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
      void navigator.storage.persisted()
        .then(async (already) => (already ? true : navigator.storage.persist()))
        .then((granted) => (this.persistentStorage = granted ? 'granted' : 'denied'))
        .catch(() => (this.persistentStorage = 'unknown'));
    } else {
      this.persistentStorage = 'unsupported';
    }
    // The delight layer (spec §12) — after ready so it never delays boot.
    this.eggs = new EggEngine({
      registry: REGISTRY,
      rolloverHour: this.state.settings.rolloverHour,
      load: () => this.repo.getKv<EggState>('eggState'),
      save: (s) => this.repo.setKv('eggState', s),
    });
    await this.eggs.ready;
    this.syncEggMirrors();
    this.fireEgg('appOpened');
  }

  // ── delight layer (spec §12) ─────────────────────────────────────────────

  private syncEggMirrors(): void {
    if (!this.eggs) return;
    this.eggStreak = this.eggs.streakDays;
    this.eggUnlocks = this.eggs.unlocks;
    this.eggTrivia = this.eggs.triviaStats;
  }

  /** Report an app event; at most one delight presentation may result. */
  fireEgg(event: EggEvent, extra: { screen?: string } = {}): void {
    if (!this.eggs) return;
    const counts = completionCounts(this.state.tasks, new Date(), this.state.settings.rolloverHour);
    // Test determinism: under automation, delight is silent unless a specific
    // entry is forced (OC_EGG_FORCE). Humans never hit this branch.
    const automated = typeof navigator !== 'undefined' && navigator.webdriver;
    const force = typeof localStorage !== 'undefined' ? localStorage.getItem('OC_EGG_FORCE') : null;
    if (automated) {
      const def = force ? REGISTRY.find((r) => r.id === force && r.triggers.includes(event)) : undefined;
      if (def) {
        localStorage.removeItem('OC_EGG_FORCE'); // one-shot: a forced entry fires once
        presenter.show(def.present({
          event, screen: extra.screen,
          completionsToday: counts.today, lifetimeCompletions: counts.lifetime,
          streakDays: this.eggs.streakDays, storyStage: this.eggs.storyStage,
          triviaCorrect: this.eggs.triviaStats.correct, triviaTotal: this.eggs.triviaStats.total,
          unlocks: this.eggs.unlocks, now: new Date(), rng: Math.random,
        }));
      }
      return;
    }
    const presentation = this.eggs.handle(event, {
      ...extra,
      completionsToday: counts.today,
      lifetimeCompletions: counts.lifetime,
    });
    this.syncEggMirrors();
    if (presentation) presenter.show(presentation);
  }

  recordTrivia(correct: boolean): void {
    this.eggs?.recordTrivia(correct);
    this.syncEggMirrors();
    // Earned-by-knowledge discovery threshold.
    if (this.eggs && this.eggs.triviaStats.correct >= 10) this.grantUnlockAndShow('quiz-whiz');
  }

  /** Direct grant path for flows outside the registry (codes, trivia milestones). */
  grantUnlockAndShow(id: string): void {
    if (!this.eggs) return;
    if (this.eggs.grantUnlock(id)) {
      const def = UNLOCKS.find((u) => u.id === id);
      if (def) presenter.show({ kind: 'unlock', unlockId: id, label: def.label });
    }
    this.syncEggMirrors();
  }

  advanceStory(stage: number): void {
    this.eggs?.advanceStory(stage);
  }

  // ── sync lifecycle (spec §8) ─────────────────────────────────────────────

  private buildEngine(cfg: { owner: string; repo: string; token: string }): void {
    this.engine?.dispose();
    const engine = new SyncEngine({
      client: new GithubClient(cfg),
      loadLocal: () => this.repo.loadSnapshot(),
      saveLocal: async (snap) => {
        await this.repo.replaceAll(snap);
        await this.refreshFromDisk();
      },
    });
    engine.onStatus = (status, detail) => {
      this.syncStatus = status;
      this.syncDetail = detail;
      this.lastSyncAt = engine.lastSyncAt;
    };
    this.engine = engine;
    this.syncStatus = 'idle';
  }

  /** Re-read the (post-merge) db into the mirror without touching sync/ready. */
  private async refreshFromDisk(): Promise<void> {
    const loaded = await this.repo.loadState();
    this.state.lists = loaded.lists;
    this.state.tasks = loaded.tasks;
    this.state.tags = loaded.tags;
    this.state.templates = loaded.templates;
    this.state.currentTask = loaded.currentTask;
    this.state.currentTaskUpdatedAt = loaded.currentTaskUpdatedAt;
    this.state.settings = loaded.settings;
    this.state.settingsUpdatedAt = loaded.settingsUpdatedAt;
  }

  async configureSync(owner: string, repo: string, token: string): Promise<{ ok: boolean; error?: string }> {
    const probe = await new GithubClient({ owner, repo, token }).checkAuth();
    if (!probe.ok) return probe;
    await this.repo.setSyncAuth({ owner, repo, token });
    this.buildEngine({ owner, repo, token });
    await this.engine!.syncNow();
    return { ok: this.syncStatus !== 'error', error: this.syncDetail || undefined };
  }

  async disconnectSync(): Promise<void> {
    await this.repo.clearSyncAuth();
    this.engine?.dispose();
    this.engine = null;
    this.syncStatus = 'disabled';
    this.syncDetail = '';
  }

  /** Debounced push — every mutation funnels through here. */
  private requestSync(): void {
    this.engine?.requestSync();
  }

  async syncNow(): Promise<void> {
    await this.engine?.syncNow();
  }

  async updateSettings(patch: Partial<import('../domain/types').Settings>): Promise<void> {
    await this.repo.updateSettings(patch);
    this.state.settings = { ...this.state.settings, ...patch };
    this.state.settingsUpdatedAt = Date.now();
    this.requestSync();
  }

  /** Full local backup for the Settings export button. */
  exportSnapshot(): Promise<import('../sync/files').RemoteSnapshot> {
    return this.repo.loadSnapshot();
  }

  // ── lists ────────────────────────────────────────────────────────────────

  async addList(title: string, areaGroup?: string): Promise<List> {
    const list = await this.repo.createList({ title, areaGroup });
    this.state.lists.push(list);
    this.requestSync();
    return list;
  }

  async renameList(id: string, title: string): Promise<void> {
    await this.patchList(id, { title });
  }

  async regroupList(id: string, areaGroup: string | undefined): Promise<void> {
    await this.patchList(id, { areaGroup });
  }

  async setListSort(id: string, sortMode: SortMode): Promise<void> {
    await this.patchList(id, { sortMode });
  }

  private async patchList(id: string, patch: Partial<List>): Promise<void> {
    await this.repo.updateList(id, patch);
    const list = this.state.lists.find((l) => l.id === id);
    if (list) Object.assign(list, patch, { updatedAt: Date.now() });
    this.requestSync();
  }

  /**
   * Tombstones the list and its OPEN tasks (completed history survives for
   * stats — spec §6). Returns the removed task ids for the undo toast.
   */
  async removeList(id: string): Promise<string[]> {
    const openIds = this.state.tasks
      .filter((t) => t.listId === id && t.completedAt === undefined)
      .map((t) => t.id);
    for (const taskId of openIds) await this.removeTask(taskId);
    const list = this.state.lists.find((l) => l.id === id);
    if (list) this.trashLists.set(id, list);
    await this.repo.softDelete('lists', id);
    this.state.lists = this.state.lists.filter((l) => l.id !== id);
    this.requestSync();
    return openIds;
  }

  async restoreList(id: string, taskIds: string[]): Promise<void> {
    await this.repo.updateList(id, { deleted: false });
    const list = this.trashLists.get(id);
    if (list) {
      list.deleted = false;
      this.state.lists.push(list);
      this.trashLists.delete(id);
    }
    for (const taskId of taskIds) await this.restoreTask(taskId);
  }

  // ── tasks ────────────────────────────────────────────────────────────────

  /** Blank medium-priority task; the UI opens its editor with the name focused. */
  async addTask(listId: string): Promise<Task> {
    const task = await this.repo.createTask({
      listId, name: '', notes: '', priority: 'medium', tagIds: [], inProgress: false,
    });
    this.state.tasks.push(task);
    this.requestSync();
    return task;
  }

  async patchTask(id: string, patch: Partial<Task>): Promise<void> {
    await this.repo.updateTask(id, patch);
    const task = this.state.tasks.find((t) => t.id === id);
    if (task) Object.assign(task, patch, { updatedAt: Date.now() });
    this.requestSync();
  }

  async completeTask(id: string): Promise<void> {
    const task = this.state.tasks.find((t) => t.id === id);
    const wasCurrent = this.state.currentTask?.taskId === id;
    await this.patchTask(id, { completedAt: Date.now(), inProgress: false });
    this.fireEgg('taskCompleted');
    if (wasCurrent) await this.clearCurrent();
    // Arm after-completion recurrence: "come back X after done" (spec §5).
    const tpl = task?.recurrenceId
      ? this.state.templates.find((t) => t.id === task.recurrenceId && !t.deleted && !t.paused)
      : undefined;
    if (tpl) {
      const next = scheduleAfterCompletion(tpl, new Date());
      if (next !== null) await this.updateRecurring(tpl.id, { nextSpawnAt: next });
    }
    // Auto-select (2026-07-26 request): finishing THE current task rolls the next one.
    if (wasCurrent && this.state.settings.autoSelectNext) {
      const next = drawTask(this.state.tasks, this.state.settings, new Date(), Math.random);
      if (next) await this.acceptTask(next.id);
    }
  }

  async uncompleteTask(id: string): Promise<void> {
    await this.patchTask(id, { completedAt: undefined });
  }

  async removeTask(id: string): Promise<void> {
    const task = this.state.tasks.find((t) => t.id === id);
    if (task) this.trashTasks.set(id, task);
    await this.repo.softDelete('tasks', id);
    this.state.tasks = this.state.tasks.filter((t) => t.id !== id);
    this.requestSync();
  }

  async restoreTask(id: string): Promise<void> {
    await this.repo.updateTask(id, { deleted: false });
    const task = this.trashTasks.get(id);
    if (task) {
      task.deleted = false;
      this.state.tasks.push(task);
      this.trashTasks.delete(id);
    }
    this.requestSync();
  }

  // ── draw lifecycle (spec §4) ─────────────────────────────────────────────

  /** Accepting a draw: task becomes THE current task and is flagged in-progress. */
  async acceptTask(taskId: string): Promise<void> {
    await this.patchTask(taskId, { inProgress: true });
    const ref = { taskId, acceptedAt: Date.now() };
    await this.repo.setCurrentTask(ref);
    this.state.currentTask = ref;
    this.state.currentTaskUpdatedAt = Date.now();
    this.requestSync();
    this.fireEgg('drawAccepted');
  }

  /**
   * "Not Today": excluded from the randomizer pool until the next 4am rollover.
   * Touches NOTHING else — stays visible in lists/views and keeps inProgress.
   */
  async sendNotToday(taskId: string): Promise<void> {
    await this.patchTask(taskId, {
      notTodayUntil: nextRolloverTs(Date.now(), this.state.settings.rolloverHour),
    });
    if (this.state.currentTask?.taskId === taskId) await this.clearCurrent();
    this.fireEgg('drawSkipped');
  }

  async clearCurrent(): Promise<void> {
    await this.repo.setCurrentTask(null);
    this.state.currentTask = null;
    this.state.currentTaskUpdatedAt = Date.now();
    this.requestSync();
  }

  async setInProgress(taskId: string, flag: boolean): Promise<void> {
    await this.patchTask(taskId, { inProgress: flag });
  }

  // ── recurrence (spec §5) ─────────────────────────────────────────────────

  /**
   * Make a task recurring: snapshot its fields into a template and link back.
   * Scheduled modes arm immediately; afterCompletion arms when the task completes.
   */
  async createRecurring(
    taskId: string,
    mode: RecurrenceMode,
    deadlineOffsetDays?: number,
  ): Promise<RecurrenceTemplate> {
    const task = this.state.tasks.find((t) => t.id === taskId);
    if (!task) throw new Error(`createRecurring: no such task ${taskId}`);
    const armed = nextScheduledSpawn(mode, new Date(), this.state.settings.rolloverHour);
    const tpl = await this.repo.createTemplate({
      listId: task.listId,
      name: task.name,
      notes: task.notes,
      tagIds: [...task.tagIds],
      priority: task.priority,
      estimateHours: task.estimateHours,
      mode,
      deadlineOffsetDays,
      paused: false,
      nextSpawnAt: armed ?? undefined,
    });
    this.state.templates.push(tpl);
    await this.patchTask(taskId, { recurrenceId: tpl.id }); // patchTask requests sync
    return tpl;
  }

  async updateRecurring(id: string, patch: Partial<RecurrenceTemplate>): Promise<void> {
    // Cadence edits re-arm scheduled modes (afterCompletion re-arms on next completion).
    if (patch.mode) {
      const armed = nextScheduledSpawn(patch.mode, new Date(), this.state.settings.rolloverHour);
      patch = { ...patch, nextSpawnAt: armed ?? undefined };
    }
    await this.repo.updateTemplate(id, patch);
    const tpl = this.state.templates.find((t) => t.id === id);
    if (tpl) Object.assign(tpl, patch, { updatedAt: Date.now() });
    this.requestSync();
  }

  async removeRecurring(id: string): Promise<void> {
    await this.repo.softDelete('templates', id);
    this.state.templates = this.state.templates.filter((t) => t.id !== id);
    this.requestSync();
  }

  /** Materialize due templates. Called from init, window focus, and the rollover timer. */
  async runSpawnSweep(now: Date = new Date()): Promise<number> {
    const res = sweepSpawns(this.state.templates, this.state.tasks, now, this.state.settings);
    for (const draft of res.drafts) {
      const task = await this.repo.createTask(draft);
      this.state.tasks.push(task);
    }
    for (const u of res.updates) {
      await this.updateRecurring(u.id, { nextSpawnAt: u.nextSpawnAt });
    }
    if (res.drafts.length > 0) this.requestSync();
    return res.drafts.length;
  }

  // ── Things import (spec §9) ──────────────────────────────────────────────

  /**
   * Idempotent import: entities match on `thingsUuid`. New ones get app ids;
   * matches keep their app id and only update when the imported row is newer
   * than the local one (so re-imports never clobber local edits). All Things-
   * uuid cross-references are remapped to app ids. One transaction.
   */
  async importThings(mapped: MappedImport): Promise<MappedImport['counts']> {
    const snap = await this.repo.loadSnapshot();
    const idMap = new Map<string, string>();

    const upsert = <T extends { id: string; thingsUuid?: string; updatedAt: number }>(
      existing: T[],
      incoming: T[],
      remap?: (row: T) => T,
    ): T[] => {
      const byThings = new Map(existing.filter((e) => e.thingsUuid).map((e) => [e.thingsUuid!, e]));
      const out = [...existing];
      for (const raw of incoming) {
        const prior = byThings.get(raw.thingsUuid!);
        const appId = prior?.id ?? nanoid();
        idMap.set(raw.thingsUuid!, appId);
        const finalize = () => ({ ...(remap ? remap(raw) : raw), id: appId });
        if (!prior) out.push(finalize());
        else if (raw.updatedAt > prior.updatedAt) out[out.indexOf(prior)] = finalize();
      }
      return out;
    };

    const ref = (thingsUuid: string) => idMap.get(thingsUuid) ?? thingsUuid;
    // Order matters: lists/tags first so tasks/templates can resolve refs.
    snap.lists = upsert(snap.lists, mapped.lists);
    snap.tags = upsert(snap.tags, mapped.tags);
    snap.templates = upsert(snap.templates, mapped.templates, (t) => ({
      ...t, listId: ref(t.listId), tagIds: t.tagIds.map(ref),
    }));
    snap.tasks = upsert(snap.tasks, mapped.tasks, (t) => ({
      ...t,
      listId: ref(t.listId),
      tagIds: t.tagIds.map(ref),
      recurrenceId: t.recurrenceId ? ref(t.recurrenceId) : undefined,
    }));

    await this.repo.replaceAll(snap);
    await this.refreshFromDisk();
    this.requestSync();
    return mapped.counts;
  }

  // ── tags ─────────────────────────────────────────────────────────────────

  async addTag(name: string, colorIndex: number): Promise<Tag> {
    const tag = await this.repo.createTag({ name, colorIndex });
    this.state.tags.push(tag);
    this.requestSync();
    return tag;
  }
}

/** Module singleton the UI imports; tests construct their own instances. */
export const app = new AppStore();
