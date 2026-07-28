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
import { blockLifts, newlyUnblocked } from '../domain/blocking';
import { reorderPatches } from '../domain/listOrder';
import { SyncEngine, type SyncStatus } from '../sync/engine';
import { GithubClient } from '../sync/githubClient';
import { nanoid } from 'nanoid';
import type { MappedImport } from '../import/thingsMap';
import { EggEngine, type EggEvent, type EggState } from '../eggs/engine';
import { REGISTRY } from '../eggs/registry';
import { UNLOCKS } from '../eggs/content/extras';
import { presenter } from '../eggs/presenter.svelte';
import { completionCounts } from '../domain/stats';
import { undoStack } from './undo.svelte';
import { toast } from '../ui/toast.svelte';
import { openDb } from '../storage/db';
import { Repo, type AppState } from '../storage/repo';

/**
 * True inside Playwright/WebDriver. Delight is deliberately silent under
 * automation so tests are deterministic and no overlay can steal a click;
 * state changes still happen, only the celebration is withheld.
 */
const underAutomation = (): boolean => typeof navigator !== 'undefined' && navigator.webdriver;

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
  /** Events reported before the engine finished loading; replayed on ready. */
  private pendingEggs: Array<{ event: EggEvent; extra: { screen?: string } }> = [];
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
    const period = await this.repo.getKv<number | null>('workPeriod');
    this.workPeriodEndsAt = period && period > Date.now() ? period : null;

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
    // Replay anything the UI reported while the engine was still loading (the
    // app is interactive from `ready`, which lands two IndexedDB reads earlier).
    const buffered = this.pendingEggs.splice(0);
    this.fireEgg('appOpened');
    for (const b of buffered) this.fireEgg(b.event, b.extra);
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
    if (!this.eggs) {
      // Things the user actually DID are buffered, not dropped: an expired
      // timebox alerts the moment its view mounts, which can beat the engine's
      // load and would otherwise make that discovery unreachable on the reopen
      // path. Ambient events are deliberately NOT replayed — init fires
      // appOpened itself, and a screen visit recurs on the very next
      // navigation, so replaying either just doubles the noise at launch.
      const worthReplaying = event !== 'screenVisited' && event !== 'appOpened';
      if (worthReplaying && this.pendingEggs.length < 5) this.pendingEggs.push({ event, extra });
      return;
    }
    const counts = completionCounts(this.state.tasks, new Date(), this.state.settings.rolloverHour);
    // Test determinism: under automation, delight is silent unless a specific
    // entry is forced (OC_EGG_FORCE). Humans never hit this branch.
    const automated = underAutomation();
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
    if (!presentation) {
      this.syncEggMirrors();
      return;
    }
    // Earned awards must be RECORDED, not merely announced — otherwise they
    // never reach the discoveries list and could be "won" repeatedly.
    if (presentation.kind === 'unlock' && !this.eggs.grantUnlock(presentation.unlockId)) {
      this.syncEggMirrors();
      return; // already had it; don't celebrate twice
    }
    this.syncEggMirrors();
    presenter.show(presentation);
  }

  recordTrivia(correct: boolean): void {
    this.eggs?.recordTrivia(correct);
    this.syncEggMirrors();
    // Earned-by-knowledge discovery threshold.
    if (this.eggs && this.eggs.triviaStats.correct >= 10) this.grantUnlockAndShow('quiz-whiz');
  }

  /**
   * Direct grant path for flows outside the registry (codes, trivia milestones,
   * one-shot feature discoveries). Returns true when it was newly earned, so
   * callers can stay quiet instead of stacking an ambient note on top.
   */
  grantUnlockAndShow(id: string): boolean {
    if (!this.eggs) return false;
    const earned = this.eggs.grantUnlock(id);
    // The grant is always recorded; only the celebration is suppressed under
    // automation, so a stray overlay can never intercept a test's clicks.
    if (earned && !underAutomation()) {
      const def = UNLOCKS.find((u) => u.id === id);
      if (def) presenter.show({ kind: 'unlock', unlockId: id, label: def.label });
    }
    this.syncEggMirrors();
    return earned;
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

  /** Whole-list edit from the settings sheet (name, group, deadline, hours). */
  async updateList(id: string, patch: Partial<List>): Promise<void> {
    await this.patchList(id, patch);
  }

  /**
   * Commit a new home-screen order for one group. `orderedIds` is the whole
   * group in its new sequence; only rows whose position actually changed are
   * written, so an aborted drag costs nothing and syncs nothing.
   */
  async reorderLists(orderedIds: string[]): Promise<void> {
    const patches = reorderPatches(orderedIds, this.state.lists);
    for (const { id, order } of patches) await this.patchList(id, { order });
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
    // Silent per task — the list-level undo puts the whole thing back at once.
    for (const taskId of openIds) await this.removeTask(taskId, { silent: true });
    const list = this.state.lists.find((l) => l.id === id);
    if (list) this.trashLists.set(id, list);
    await this.repo.softDelete('lists', id);
    this.state.lists = this.state.lists.filter((l) => l.id !== id);
    this.requestSync();
    this.pushUndo(`Deleted list "${list?.title || 'list'}"`, () => this.restoreList(id, openIds));
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
      listId, name: '', notes: '', priority: 'medium', tagIds: [],
      inProgress: false, needsReview: true,
    });
    this.state.tasks.push(task);
    this.requestSync();
    return task;
  }

  /**
   * Mirror-first on purpose: the in-memory copy updates SYNCHRONOUSLY (before
   * any await) so callers that immediately inspect state — e.g. the pristine
   * check behind rapid entry — can never race the IndexedDB write.
   */
  /**
   * Bulk edits from multi-select. Applied one by one so every rule (recurrence
   * arming, timing, sync) behaves exactly as it would individually, then folded
   * into ONE undo entry so a mistaken sweep is a single Cmd+Z.
   */
  async bulkApply(
    taskIds: string[],
    action: 'complete' | 'delete' | 'move' | 'priority',
    value?: string,
  ): Promise<void> {
    const before = taskIds
      .map((id) => this.state.tasks.find((t) => t.id === id))
      .filter((t): t is Task => t !== undefined)
      .map((t) => ({ id: t.id, listId: t.listId, priority: t.priority }));
    if (before.length === 0) return;

    // Collect each item's real inverse as we go. For completions that means
    // lifting the entry completeTask just pushed rather than writing our own:
    // it alone knows to restore the in-progress flag, the elapsed clock, the
    // current-task slot and any recurrence it armed.
    const inverse: Array<() => Promise<void>> = [];
    for (const snap of before) {
      if (action === 'complete') {
        const priorTop = undoStack.latest?.id;
        await this.completeTask(snap.id, { bulk: true });
        if (undoStack.latest && undoStack.latest.id !== priorTop) {
          const taken = undoStack.takeLatest();
          if (taken) inverse.push(taken.run);
        }
      } else if (action === 'delete') {
        await this.removeTask(snap.id, { silent: true });
        inverse.push(() => this.restoreTask(snap.id));
      } else if (action === 'move' && value) {
        await this.patchTask(snap.id, { listId: value });
        inverse.push(() => this.patchTask(snap.id, { listId: snap.listId }));
      } else if (action === 'priority' && value) {
        await this.patchTask(snap.id, { priority: value as Task['priority'] });
        inverse.push(() => this.patchTask(snap.id, { priority: snap.priority }));
      }
    }
    if (inverse.length === 0) return;

    const verb = action === 'complete' ? 'Completed'
      : action === 'delete' ? 'Deleted'
      : action === 'move' ? 'Moved'
      : 'Re-prioritised';
    this.pushUndo(`${verb} ${before.length} task${before.length === 1 ? '' : 's'}`, async () => {
      // Reverse order, so overlapping effects unwind the way they were applied.
      for (const run of [...inverse].reverse()) await run();
    });
  }

  /** Move a task to another list (the move control on the task editor). */
  async moveTask(id: string, listId: string): Promise<void> {
    await this.patchTask(id, { listId });
  }

  async patchTask(id: string, patch: Partial<Task>): Promise<void> {
    const task = this.state.tasks.find((t) => t.id === id);
    if (task) Object.assign(task, patch, { updatedAt: Date.now() });
    await this.repo.updateTask(id, patch);
    this.requestSync();
  }

  /**
   * Rapid entry's escape hatch: a task that was created but never actually
   * filled in gets discarded silently (tombstoned, so the discard syncs).
   * Returns whether it was discarded.
   */
  async discardIfPristine(taskId: string): Promise<boolean> {
    const t = this.state.tasks.find((x) => x.id === taskId);
    if (!t) return false;
    const untouched =
      t.name.trim() === '' && t.notes.trim() === '' && t.priority === 'medium' &&
      t.tagIds.length === 0 && t.deadline === undefined && t.estimateHours === undefined &&
      t.recurrenceId === undefined && !t.inProgress && t.completedAt === undefined &&
      // A cleared review flag means a field was deliberately touched — keep it.
      t.needsReview === true;
    if (!untouched) return false;
    await this.removeTask(taskId, { silent: true });
    return true;
  }

  /**
   * `bulk` marks a completion that is one item in a multi-select sweep. It
   * suppresses the auto-select draw: rolling a fresh task in the middle of a
   * batch picks from tasks the batch is still working through, leaves an
   * untouched task flagged in-progress, and is not something the batch's single
   * undo entry can take back. The sweep is not "finishing the current task".
   */
  async completeTask(id: string, opts: { bulk?: boolean } = {}): Promise<void> {
    const task = this.state.tasks.find((t) => t.id === id);
    const wasCurrent = this.state.currentTask?.taskId === id;
    // Snapshot enough to put things back exactly as they were.
    const before = task
      ? {
          name: task.name, inProgress: task.inProgress, recurrenceId: task.recurrenceId,
          startedAt: task.startedAt, activeMs: task.activeMs,
        }
      : null;
    const priorCurrent = this.state.currentTask;
    const priorSpawnAt = before?.recurrenceId
      ? this.state.templates.find((t) => t.id === before.recurrenceId)?.nextSpawnAt
      : undefined;

    const finishedAt = Date.now();
    // Time counts ONLY when finishing something you were actively working on.
    // Ticking it off the list — or completing it after pausing — records nothing,
    // because that stretch was never tracked to completion.
    const tracked = task?.inProgress && task.startedAt !== undefined
      ? (task.activeAccumulatedMs ?? 0) + (finishedAt - task.startedAt)
      : undefined;

    // Did this open a door? Asked before the write, because newlyUnblocked
    // answers "given that this one is done" regardless of whether that has
    // been recorded yet — which is what lets the undo below be armed first.
    const freed = newlyUnblocked(id, this.state.tasks);

    // Register the undo BEFORE the mutation, not after it.
    //
    // patchTask updates the in-memory mirror SYNCHRONOUSLY and only then awaits
    // the IndexedDB write, so the row leaves the screen the instant the patch
    // is applied — while the write is still in flight. Arming the undo after
    // that await therefore still left a window where the task had visibly
    // vanished and Cmd+Z found an empty stack. (An earlier fix moved the push
    // up to just after the patch, which shortened the window without closing
    // it; CI kept failing intermittently until it moved above the patch.)
    //
    // Safe to arm first: the closure only reads state captured above, and
    // every step below is something undo reverses anyway.
    const freedNote = freed.length === 0 ? ''
      : freed.length === 1 ? ` — unblocked "${freed[0]!.name || 'a task'}"`
      : ` — unblocked ${freed.length} tasks`;
    this.pushUndo(`Completed "${before?.name || 'task'}"${freedNote}`, async () => {
      // Put the clock back too, or an undone completion silently forgets how
      // long the task had already been running.
      await this.patchTask(id, {
        completedAt: undefined,
        inProgress: before?.inProgress ?? false,
        startedAt: before?.startedAt,
        activeMs: before?.activeMs,
      });
      // Un-arm any recurrence this completion scheduled, so it can't respawn.
      if (before?.recurrenceId) {
        await this.updateRecurring(before.recurrenceId, { nextSpawnAt: priorSpawnAt });
      }
      if (wasCurrent) {
        await this.repo.setCurrentTask(priorCurrent);
        this.state.currentTask = priorCurrent;
        this.state.currentTaskUpdatedAt = Date.now();
      }
    });

    await this.patchTask(id, {
      completedAt: finishedAt,
      inProgress: false,
      startedAt: undefined,
      timeboxEndsAt: undefined,
      ...(tracked && tracked > 0 ? { activeMs: tracked } : {}),
    });

    if (freed.length > 0) {
      // Reported first, so freeing blocked work is the headline and the
      // ordinary completion quip is what the governor drops.
      this.fireEgg('taskUnblocked');
      if (freed.length >= 3) this.grantUnlockAndShow('load-bearing');
    }
    this.fireEgg('taskCompleted');

    // Feed the recurring template's rolling average of how long it really takes.
    if (before?.recurrenceId && tracked !== undefined) {
      const tpl = this.state.templates.find((t) => t.id === before.recurrenceId && !t.deleted);
      const elapsed = tracked;
      if (tpl && elapsed > 0) {
        const n = tpl.completedInstances ?? 0;
        const mean = tpl.avgActiveMs ?? 0;
        await this.updateRecurring(tpl.id, {
          avgActiveMs: Math.round((mean * n + elapsed) / (n + 1)),
          completedInstances: n + 1,
        });
      }
    }
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
    if (wasCurrent && !opts.bulk && this.state.settings.autoSelectNext) {
      const next = drawTask(
        this.state.tasks, this.state.settings, new Date(), Math.random, undefined, undefined,
        blockLifts(this.state.tasks, this.state.settings, new Date()),
      );
      if (next) await this.acceptTask(next.id);
    }

  }

  async uncompleteTask(id: string): Promise<void> {
    await this.patchTask(id, { completedAt: undefined });
  }

  /**
   * `silent` skips the undo entry — used by the pristine sweep, which discards
   * an empty task the user never filled in (there is nothing to regret).
   */
  async removeTask(id: string, opts: { silent?: boolean } = {}): Promise<void> {
    const task = this.state.tasks.find((t) => t.id === id);
    if (task) this.trashTasks.set(id, task);
    await this.repo.softDelete('tasks', id);
    this.state.tasks = this.state.tasks.filter((t) => t.id !== id);
    this.requestSync();
    if (!opts.silent) {
      this.pushUndo(`Deleted "${task?.name || 'task'}"`, () => this.restoreTask(id));
    }
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

  // ── undo ─────────────────────────────────────────────────────────────────

  /** Record a reversible action and surface it as a tappable toast. */
  private pushUndo(label: string, run: () => Promise<void>): void {
    const entry = undoStack.push(label, run);
    toast.show(label, () => void undoStack.undoEntry(entry));
  }

  /** Cmd/Ctrl+Z. Returns what was undone, for the confirmation toast. */
  async undoLast(): Promise<string | null> {
    return undoStack.undo();
  }

  // ── draw lifecycle (spec §4) ─────────────────────────────────────────────

  /** Accepting a draw: task becomes THE current task and is flagged in-progress. */
  async acceptTask(taskId: string): Promise<void> {
    const task = this.state.tasks.find((t) => t.id === taskId);
    // Stamp the clock the first time it's picked up — that's what "completed
    // in" measures. Re-accepting later keeps the original start.
    const startedAt = task?.startedAt ?? Date.now();
    // A timebox set on the task (or inherited from its template) starts now.
    const minutes = task?.timeboxMinutes;
    await this.patchTask(taskId, {
      inProgress: true,
      startedAt,
      ...(minutes ? { timeboxEndsAt: Date.now() + minutes * 60_000 } : {}),
    });
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
    const task = this.state.tasks.find((t) => t.id === taskId);
    const priorSnooze = task?.notTodayUntil;
    const priorCurrent = this.state.currentTask;
    const wasCurrent = priorCurrent?.taskId === taskId;

    await this.patchTask(taskId, {
      notTodayUntil: nextRolloverTs(Date.now(), this.state.settings.rolloverHour),
    });
    if (wasCurrent) await this.clearCurrent();
    this.fireEgg('drawSkipped');

    this.pushUndo(`Snoozed "${task?.name || 'task'}"`, async () => {
      await this.patchTask(taskId, { notTodayUntil: priorSnooze });
      if (wasCurrent) {
        await this.repo.setCurrentTask(priorCurrent);
        this.state.currentTask = priorCurrent;
        this.state.currentTaskUpdatedAt = Date.now();
      }
    });
  }

  async clearCurrent(): Promise<void> {
    await this.repo.setCurrentTask(null);
    this.state.currentTask = null;
    this.state.currentTaskUpdatedAt = Date.now();
    this.requestSync();
  }

  /**
   * Starting banks nothing; pausing banks the stretch just worked. Resuming
   * later continues the count from where it left off.
   */
  async setInProgress(taskId: string, flag: boolean): Promise<void> {
    const task = this.state.tasks.find((t) => t.id === taskId);
    if (!task) return;
    if (flag) {
      await this.patchTask(taskId, {
        inProgress: true,
        ...(task.startedAt === undefined ? { startedAt: Date.now() } : {}),
      });
      return;
    }
    const banked = (task.activeAccumulatedMs ?? 0) +
      (task.startedAt ? Date.now() - task.startedAt : 0);
    await this.patchTask(taskId, {
      inProgress: false,
      startedAt: undefined,
      activeAccumulatedMs: banked > 0 ? banked : undefined,
      timeboxEndsAt: undefined, // the clock stops with the work
    });
  }

  /**
   * A work period: a wider window during which the randomizer only offers
   * tasks whose estimate fits the time remaining (emergencies excepted).
   * Device-local — it describes what YOU are doing right now, not your data.
   */
  workPeriodEndsAt = $state<number | null>(null);

  async startWorkPeriod(minutes: number): Promise<void> {
    this.workPeriodEndsAt = Date.now() + minutes * 60_000;
    await this.repo.setKv('workPeriod', this.workPeriodEndsAt);
  }

  async endWorkPeriod(): Promise<void> {
    this.workPeriodEndsAt = null;
    await this.repo.setKv('workPeriod', null);
  }

  /** Hours left in the period, or null when none is running / it's over. */
  workPeriodHoursLeft(now = Date.now()): number | null {
    if (!this.workPeriodEndsAt) return null;
    const ms = this.workPeriodEndsAt - now;
    return ms > 0 ? ms / 3_600_000 : null;
  }

  /** Start (or restart) a countdown on a task; minutes 0 clears it. */
  async startTimebox(taskId: string, minutes: number): Promise<void> {
    await this.patchTask(taskId, {
      timeboxMinutes: minutes > 0 ? minutes : undefined,
      timeboxEndsAt: minutes > 0 ? Date.now() + minutes * 60_000 : undefined,
    });
  }

  async clearTimebox(taskId: string): Promise<void> {
    await this.patchTask(taskId, { timeboxEndsAt: undefined });
  }

  /** Add or clear the default timebox a recurring task hands its instances. */
  async setTemplateTimebox(templateId: string, minutes: number | undefined): Promise<void> {
    await this.updateRecurring(templateId, { timeboxMinutes: minutes });
  }

  /**
   * Mark a task triaged. Called when the user deliberately opens it or touches
   * any field but the name. No-ops when already reviewed, so it never churns
   * updatedAt (which would make it lose sync merges it should have won).
   */
  async markReviewed(taskId: string): Promise<void> {
    const t = this.state.tasks.find((x) => x.id === taskId);
    if (!t?.needsReview) return;
    await this.patchTask(taskId, { needsReview: false });
  }

  /** Open tasks still awaiting a once-over — the fill-in prompt's pool. */
  tasksNeedingReview(): Task[] {
    return this.state.tasks.filter(
      (t) => t.needsReview && !t.deleted && t.completedAt === undefined,
    );
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
  async importThings(
    mapped: MappedImport,
    opts: { countHistoryInTotals?: boolean } = {},
  ): Promise<MappedImport['counts']> {
    // Belt and braces against the bug class that has now bitten this codebase
    // three times: a reactive proxy reaching IndexedDB, which cannot
    // structured-clone one ("Proxy object could not be cloned"). The caller is
    // fixed not to send proxies, but this is the single choke point and the
    // failure lands mid-import on someone's whole task history, so it is worth
    // the one pass. A no-op on data that is already plain.
    mapped = $state.snapshot(mapped) as MappedImport;

    if (opts.countHistoryInTotals) {
      // Opted in: treat imported completions as ordinary completions.
      mapped = { ...mapped, tasks: mapped.tasks.map((t) => ({ ...t, importedHistory: undefined })) };
    }
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
