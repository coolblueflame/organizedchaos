/**
 * The app's single state layer: a Svelte-5 runes mirror of AppState, with every
 * mutation flowing Repo-first (persist), then patching the mirror in place.
 * Screens import the `app` singleton and never touch Repo/Dexie directly.
 */
import {
  DEFAULT_SETTINGS,
  type List, type RecurrenceMode, type RecurrenceTemplate, type SortMode, type Tag, type Task,
} from '../domain/types';
import { appDayKey, nextRolloverTs } from '../domain/time';
import { nextScheduledSpawn, scheduleAfterCompletion, sweepSpawns } from '../domain/recurrence';
import { bumpPepperRolls, pepperRollsFor, resetPepperRolls } from './pepperRolls';
import { drawTask } from '../domain/randomizer';
import { blockLifts, newlyUnblocked } from '../domain/blocking';
import {
  creditWindowIndex, dueRitualIds, isPerWindow, isRitualTask, ritualExclusions, ritualSlot,
  ritualWindows, withRitualLifts,
} from '../domain/ritual';
import { snoozeUntilTs, type SweepVerdict } from '../domain/sweep';
import { archivedTaskIds } from '../domain/archive';
import { lockedTaskIds } from '../domain/lock';
import { lockSession } from './lockSession.svelte';
import { liveQueueIds } from '../domain/dayQueue';
import { ensureNotificationPermission } from '../ui/notify';
import { reorderPatches } from '../domain/listOrder';
import { customOrderPatches } from '../domain/views';
import { SyncEngine, type FileCache, type SyncStatus } from '../sync/engine';
import { GithubClient } from '../sync/githubClient';
import { nanoid } from 'nanoid';
import type { MappedImport } from '../import/thingsMap';
import { EggEngine, type EggEvent, type EggState } from '../eggs/engine';
import { REGISTRY } from '../eggs/registry';
import { UNLOCKS } from '../eggs/content/extras';
import { presenter } from '../eggs/presenter.svelte';
import {
  burdenTasks, completionCounts, estimateOutcome, maxCompletionsInOneDay,
  MIN_TRACKED_MS, totalEstimateHours, type BurdenLedger,
} from '../domain/stats';
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
    queueIds: [], queueUpdatedAt: 0,
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
  /** App-day key of the newest completion — '' until the engine loads. */
  eggLastCompletionDay = $state('');
  eggBestStreak = $state(0);
  eggUnlocks = $state<string[]>([]);
  eggTrivia = $state({ correct: 0, total: 0 });
  /** Daily backlog measurements (see domain/stats.BurdenLedger) — synced. */
  burdenLedger = $state<BurdenLedger>({});
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
    this.state.queueIds = loaded.queueIds;
    this.state.queueUpdatedAt = loaded.queueUpdatedAt;
    this.burdenLedger = (await this.repo.getKv<BurdenLedger>('burdenLedger')) ?? {};
    // Materialize any recurrences that came due while the app was closed.
    // (This also takes the day's burden measurement — see runSpawnSweepBody.)
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
    this.repairMisgrantedUnlocks();
    this.syncEggMirrors();
    // Replay anything the UI reported while the engine was still loading (the
    // app is interactive from `ready`, which lands two IndexedDB reads earlier).
    const buffered = this.pendingEggs.splice(0);
    this.fireEgg('appOpened');
    for (const b of buffered) this.fireEgg(b.event, b.extra);
  }

  // ── delight layer (spec §12) ─────────────────────────────────────────────

  /**
   * 2026-08-12: the bulk bar's "done" button (since renamed and armed) was
   * mistaken for "close" and completed an entire 700-task library at once.
   * The completions were undone, but the completions-in-a-day discovery the
   * burst granted could not be — the sync merge only ever unions, so every
   * device kept restoring it (that incident is why unlock revocation exists
   * at all; see DelightProgress.unlockGrants).
   *
   * The check self-verifies against the logbook instead of hardcoding one
   * account's accident: anyone whose history shows a real day at the bar
   * keeps the discovery untouched. The revocation is stamped at the fixed
   * incident time, so every device reaches the same verdict — and a genuine
   * 50-completion day afterwards re-grants it with a newer clock, which wins.
   * Runs each boot; once revoked (or once genuinely held) it is a no-op.
   */
  private repairMisgrantedUnlocks(): void {
    if (!this.eggs || !this.eggs.unlocks.includes('landslide')) return;
    const incidentMs = Date.UTC(2026, 7, 12, 16); // just after the accidental burst
    if (maxCompletionsInOneDay(this.state.tasks, this.state.settings.rolloverHour) >= 50) return;
    this.eggs.revokeUnlock('landslide', incidentMs);
  }

  private syncEggMirrors(): void {
    if (!this.eggs) return;
    this.eggStreak = this.eggs.streakDays;
    this.eggBestStreak = this.eggs.bestStreakDays;
    this.eggLastCompletionDay = this.eggs.lastCompletionDay;
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
      // Silent, not amnesiac: the streak (and its fed-today display state)
      // still advances under webdriver — only the lottery stays off.
      this.eggs.noteQuietly(event);
      this.syncEggMirrors();
      const def = force ? REGISTRY.find((r) => r.id === force && r.triggers.includes(event)) : undefined;
      if (def) {
        localStorage.removeItem('OC_EGG_FORCE'); // one-shot: a forced entry fires once
        presenter.show(def.present({
          event, screen: extra.screen,
          completionsToday: counts.today, lifetimeCompletions: counts.lifetime,
          streakDays: this.eggs.streakDays, storyStage: this.eggs.storyStage,
          triviaCorrect: this.eggs.triviaStats.correct, triviaTotal: this.eggs.triviaStats.total,
          unlocks: this.eggs.unlocks, daysSinceStoryBeat: null, now: new Date(), rng: Math.random,
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
    if (this.eggs && this.eggs.triviaStats.correct >= 25) this.grantUnlockAndShow('quiz-master');
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
      // Device-local: what this device last downloaded, so unchanged files are
      // never fetched twice. Never synced — it describes a device's view, not
      // the user's data.
      loadCache: () => this.repo.getKv<FileCache>('syncFileCache'),
      saveCache: (cache) => this.repo.setKv('syncFileCache', cache),
      saveLocal: async (snap) => {
        await this.repo.replaceAll(snap);
        await this.refreshFromDisk();
        // The engine holds its state in memory and rewrites it on every event,
        // so storage alone is not enough: without this, the next completion
        // would overwrite whatever the other device had just taught us.
        if (snap.delight && this.eggs?.absorb(snap.delight)) this.syncEggMirrors();
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

  /** Task tombstones, read fresh from disk — see Repo.deletedTasks. */
  async deletedTasks(): Promise<Task[]> {
    return this.repo.deletedTasks();
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
    this.state.queueIds = loaded.queueIds;
    this.state.queueUpdatedAt = loaded.queueUpdatedAt;
    this.burdenLedger = (await this.repo.getKv<BurdenLedger>('burdenLedger')) ?? {};
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
    const settingsStamp = await this.repo.updateSettings(patch);
    this.state.settings = { ...this.state.settings, ...patch };
    this.state.settingsUpdatedAt = settingsStamp;
    this.requestSync();
  }

  /** Full local backup for the Settings export button. */
  exportSnapshot(): Promise<import('../sync/files').RemoteSnapshot> {
    return this.repo.loadSnapshot();
  }

  // ── serverless reminders (2026-07-30) ────────────────────────────────────

  /**
   * Register/deregister THIS device in the data repo's push-subscriptions.json
   * — the file the reminders Action reads. Wholesale read-modify-write keyed
   * by endpoint; needs sync to be connected (the same PAT does the writing).
   */
  async saveReminderSubscription(sub: PushSubscription, device: string, enable: boolean): Promise<void> {
    const auth = await this.repo.getSyncAuth();
    if (!auth) throw new Error('connect sync first — reminders ride on the same repo');
    const client = new GithubClient(auth);
    const path = 'push-subscriptions.json';
    const file = await client.getFile(path);
    const rows: Array<{ device: string; endpoint: string; subscription: unknown; updatedAt: number }> =
      Array.isArray(file?.json) ? (file!.json as never) : [];
    const kept = rows.filter((r) => r.endpoint !== sub.endpoint);
    if (enable) {
      kept.push({ device, endpoint: sub.endpoint, subscription: sub.toJSON(), updatedAt: Date.now() });
    }
    await client.putFile(path, kept, file?.sha);
  }

  // ── the day queue (2026-07-29 request) ───────────────────────────────────

  /**
   * Every queue mutation funnels through here: prune dead ids while we're
   * writing anyway, spread into a PLAIN array ($state proxies cannot be
   * structured-cloned into IndexedDB), mirror synchronously, and hold the
   * same stamp the database wrote so sync merges agree with what we show.
   */
  private async writeQueue(ids: string[]): Promise<void> {
    const plain = liveQueueIds([...ids], this.state.tasks);
    this.state.queueIds = plain;
    this.state.queueUpdatedAt = await this.repo.updateQueue(plain);
    this.requestSync();
  }

  /** The queue as the UI should render it — live, open tasks only. */
  queuedTasks(): Task[] {
    const byId = new Map(this.state.tasks.map((t) => [t.id, t]));
    return liveQueueIds(this.state.queueIds, this.state.tasks)
      .map((id) => byId.get(id))
      .filter((t): t is Task => t !== undefined);
  }

  async addToQueue(id: string): Promise<void> {
    if (this.state.queueIds.includes(id)) return;
    await this.writeQueue([...this.state.queueIds, id]);
    this.fireEgg('queuePlanned');
  }

  /** Bulk add from multi-select; already-queued tasks keep their position. */
  async addManyToQueue(ids: string[]): Promise<void> {
    const have = new Set(this.state.queueIds);
    const fresh = ids.filter((id) => !have.has(id));
    if (fresh.length === 0) return;
    await this.writeQueue([...this.state.queueIds, ...fresh]);
    this.fireEgg('queuePlanned');
  }

  async removeFromQueue(id: string): Promise<void> {
    if (!this.state.queueIds.includes(id)) return;
    await this.writeQueue(this.state.queueIds.filter((x) => x !== id));
  }

  async reorderQueue(ids: string[]): Promise<void> {
    await this.writeQueue(ids);
  }

  /** The "clear queue" button is confirmed in the UI AND undoable — belt & braces. */
  async clearQueue(): Promise<void> {
    const prior = [...this.state.queueIds];
    if (prior.length === 0) return;
    // Undo armed BEFORE the mutation (the mirror clears synchronously inside
    // writeQueue, so a Cmd+Z can land while the disk write is still in flight —
    // the same ordering completeTask had to learn three times).
    this.pushUndo('Cleared the queue', () => this.writeQueue(prior), () => this.writeQueue([]));
    await this.writeQueue([]);
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
   * Re-file a list under a different heading — what dragging it past one means.
   * The empty string is the ungrouped bucket at the top, and is stored as no
   * group at all rather than as a group literally named "".
   */
  async moveListToGroup(id: string, group: string): Promise<void> {
    await this.patchList(id, { areaGroup: group.trim() || undefined });
  }

  /** Shelve or revive a list — see domain/archive.ts for what that means. */
  async setListArchived(id: string, archived: boolean): Promise<void> {
    await this.patchList(id, { archived: archived || undefined });
  }

  async setListLocked(id: string, locked: boolean): Promise<void> {
    await this.patchList(id, { locked: locked || undefined });
  }

  /** Commit a hand-arranged custom order for one list's open tasks. */
  async reorderTasksInList(orderedIds: string[]): Promise<void> {
    const patches = customOrderPatches(orderedIds, this.state.tasks);
    for (const { id, order } of patches) await this.patchTask(id, { order });
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
    const title = this.state.lists.find((l) => l.id === id)?.title;
    await this.deleteListSilently(id, openIds);
    this.pushUndo(`Deleted list "${title || 'list'}"`,
      () => this.restoreList(id, openIds),
      // The captured openIds bound what a redo may take — but filtered to
      // what is STILL open when it runs: a completion that synced in from
      // another device between the undo and the redo is history, and history
      // survives list deletion (spec §6). Without the filter, the redo's
      // tombstone would out-stamp the remote completion and erase it
      // everywhere.
      () => this.deleteListSilently(id, openIds.filter((tid) => {
        const t = this.state.tasks.find((x) => x.id === tid);
        return t !== undefined && !t.deleted && t.completedAt === undefined;
      })));
    return openIds;
  }

  /** The deletion itself, shared by the action and its redo. */
  private async deleteListSilently(id: string, openIds: string[]): Promise<void> {
    // Silent per task — the list-level undo puts the whole thing back at once.
    for (const taskId of openIds) await this.removeTask(taskId, { silent: true });
    const list = this.state.lists.find((l) => l.id === id);
    if (list) this.trashLists.set(id, list);
    await this.repo.softDelete('lists', id);
    this.state.lists = this.state.lists.filter((l) => l.id !== id);
    this.requestSync();
  }

  /**
   * Un-delete a list and its tasks.
   *
   * Pushing the trashed copy back in unconditionally used to be enough, but a
   * sync can return the row to the mirror first — a merge resolving in favour
   * of another device's live copy, say — and then the push added a SECOND
   * entry for the same list. That is the "my list keeps growing" report: not
   * new lists, one list twice. Adopt whatever is already there, and fall back
   * to the trashed copy only when it is genuinely absent.
   */
  async restoreList(id: string, taskIds: string[]): Promise<void> {
    await this.repo.updateList(id, { deleted: false });
    const trashed = this.trashLists.get(id);
    this.trashLists.delete(id);
    const existing = this.state.lists.find((l) => l.id === id);
    if (existing) existing.deleted = false;
    else if (trashed) {
      trashed.deleted = false;
      this.state.lists.push(trashed);
    }
    for (const taskId of taskIds) await this.restoreTask(taskId);
    this.requestSync(); // was missing entirely: a restore never propagated
  }

  // ── tasks ────────────────────────────────────────────────────────────────

  /**
   * Blank medium-priority task, available THIS TICK.
   *
   * Synchronous on purpose: the Enter-chain must mount the next editor in the
   * same event turn as the keystroke, or fast typing lands in the editor of
   * the task just committed (found via an instrumented e2e — the probe caught
   * "first renamedsecond" sitting in the old input). The insert persists in
   * the background, serialized by the repo so no later write can outrun it.
   */
  addTaskEager(listId: string): Task {
    const task = this.repo.createTaskEager({
      listId, name: '', notes: '', priority: 'medium', tagIds: [],
      inProgress: false, needsReview: true,
    });
    this.state.tasks.push(task);
    this.requestSync();
    return task;
  }

  /** As addTaskEager, but resolves only once the row is on disk — quick-add's
   *  await-the-creation discipline depends on that contract. */
  async addTask(listId: string): Promise<Task> {
    const task = this.addTaskEager(listId);
    await this.repo.taskPersisted(task.id);
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
    action: 'complete' | 'delete' | 'move' | 'priority' | 'tag' | 'queue' | 'estimate',
    value?: string,
  ): Promise<void> {
    // Queueing is one singleton write, not a per-task loop — handle it whole.
    if (action === 'queue') {
      const prior = [...this.state.queueIds];
      const have = new Set(prior);
      const added = taskIds.filter((id) => !have.has(id)).length;
      if (added === 0) return;
      // Armed before the write — see clearQueue. The redo appends via the
      // SILENT primitive, not addManyToQueue: that method ends by firing the
      // queuePlanned delight event, and a redo re-establishes state, never
      // ceremony (three reviewers caught this one independently).
      this.pushUndo(`Queued ${added} task${added === 1 ? '' : 's'}`,
        () => this.writeQueue(prior),
        () => {
          const have = new Set(this.state.queueIds);
          const fresh = taskIds.filter((id) => !have.has(id));
          return this.writeQueue([...this.state.queueIds, ...fresh]);
        });
      await this.addManyToQueue(taskIds);
      return;
    }
    const before = taskIds
      .map((id) => this.state.tasks.find((t) => t.id === id))
      .filter((t): t is Task => t !== undefined)
      .map((t) => ({
        id: t.id, listId: t.listId, priority: t.priority, tagIds: [...t.tagIds],
        estimateHours: t.estimateHours, needsReview: t.needsReview,
      }));
    if (before.length === 0) return;

    // Collect each item's real inverse — and its forward, for redo — as we
    // go. For completions that means lifting the entry completeTask just
    // pushed rather than writing our own: it alone knows to restore the
    // in-progress flag, the elapsed clock, the current-task slot and any
    // recurrence it armed.
    const inverse: Array<() => Promise<void>> = [];
    const forward: Array<() => Promise<void>> = [];
    for (const snap of before) {
      if (action === 'complete') {
        const priorTop = undoStack.latest?.id;
        await this.completeTask(snap.id, { bulk: true });
        if (undoStack.latest && undoStack.latest.id !== priorTop) {
          const taken = undoStack.takeLatest();
          if (taken) {
            inverse.push(taken.run);
            if (taken.redo) forward.push(taken.redo);
          }
        }
      } else if (action === 'delete') {
        await this.removeTask(snap.id, { silent: true });
        inverse.push(() => this.restoreTask(snap.id));
        forward.push(() => this.removeTask(snap.id, { silent: true }));
      } else if (action === 'move' && value) {
        await this.patchTask(snap.id, { listId: value });
        inverse.push(() => this.patchTask(snap.id, { listId: snap.listId }));
        forward.push(() => this.patchTask(snap.id, { listId: value }));
      } else if (action === 'priority' && value) {
        await this.patchTask(snap.id, { priority: value as Task['priority'] });
        inverse.push(() => this.patchTask(snap.id, { priority: snap.priority }));
        forward.push(() => this.patchTask(snap.id, { priority: value as Task['priority'] }));
      } else if (action === 'tag' && value) {
        // Adding, never replacing — the point is to label a batch, not to wipe
        // whatever labels its members already carry. A task that already has it
        // is skipped so the undo puts back exactly what was there.
        if (!snap.tagIds.includes(value)) {
          await this.patchTask(snap.id, { tagIds: [...snap.tagIds, value] });
          inverse.push(() => this.patchTask(snap.id, { tagIds: snap.tagIds }));
          forward.push(() => this.patchTask(snap.id, { tagIds: [...snap.tagIds, value] }));
        }
      } else if (action === 'estimate' && value) {
        // One patch does both halves of the ask (Ben, 2026-08-05): the
        // estimate lands AND the NEW badge clears — an estimate is triage,
        // and a fifty-row music list should not need each card opened twice.
        const hours = Number(value);
        await this.patchTask(snap.id, { estimateHours: hours, needsReview: false });
        inverse.push(() => this.patchTask(snap.id, {
          estimateHours: snap.estimateHours, needsReview: snap.needsReview,
        }));
        forward.push(() => this.patchTask(snap.id, { estimateHours: hours, needsReview: false }));
      }
    }
    if (inverse.length === 0) return;

    const verb = action === 'complete' ? 'Completed'
      : action === 'delete' ? 'Deleted'
      : action === 'move' ? 'Moved'
      : action === 'tag' ? 'Tagged'
      : action === 'estimate' ? 'Estimated'
      : 'Re-prioritised';
    // `inverse` counts what actually changed — tagging skips tasks that already
    // wore it, and the toast should not claim to have touched them.
    const touched = action === 'tag' ? inverse.length : before.length;
    this.pushUndo(`${verb} ${touched} task${touched === 1 ? '' : 's'}`, async () => {
      // Reverse order, so overlapping effects unwind the way they were applied.
      for (const run of [...inverse].reverse()) await run();
    },
    // Only when every item contributed a forward — a batch that redoes
    // some of its members would be worse than one that honestly can't.
    forward.length === inverse.length
      ? async () => { for (const run of forward) await run(); }
      : undefined);
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
   * Finishing a daily ritual (see domain/ritual.ts).
   *
   * The ritual row itself is never completed — completing it would take it off
   * the list, and it has to be there again tomorrow. Instead the day is stamped
   * on it, and a completed copy is written for the record, so the thing you did
   * shows up in today's wins and in your history like any other finished task.
   * That copy is an ordinary task: it carries no window, so it never becomes a
   * ritual itself.
   */
  private async completeRitual(task: Task, opts: { bulk?: boolean } = {}): Promise<void> {
    const now = new Date();
    const day = appDayKey(now, this.state.settings.rolloverHour);
    const perWindow = isPerWindow(task);
    // Which mark this completion writes. Per-window rituals credit the active
    // (or next) unmarked window; -1 / already-done means no day-mark is owed.
    const credit = perWindow ? creditWindowIndex(task, now, this.state.settings.rolloverHour) : -1;
    // An already-done-today ritual can still be completed AGAIN (Ben really
    // did one twice, 2026-08-05): the day keeps its existing marks, but the
    // record is written and the work is put down like any completion. This
    // used to be an early return — which left a re-accepted done ritual
    // stranded as the current task, confetti and all, uncompletable.
    const owed = perWindow ? credit !== -1 : task.ritualDoneDay !== day;

    // Time counts the same way it does anywhere else: only a stretch that was
    // actually being tracked when it finished, and only when it clears
    // MIN_TRACKED_MS — see completeTask. It belongs to the record, not to
    // the ritual, which is about to start tomorrow from nothing.
    const finishedAt = Date.now();
    const rawTracked = task.inProgress && task.startedAt !== undefined
      ? (task.activeAccumulatedMs ?? 0) + (finishedAt - task.startedAt)
      : undefined;
    const tracked = rawTracked !== undefined && rawTracked >= MIN_TRACKED_MS ? rawTracked : undefined;
    const wasInProgress = task.inProgress;
    const priorStartedAt = task.startedAt;
    const priorAccumulated = task.activeAccumulatedMs;
    const priorTimebox = task.timeboxEndsAt;

    const record = await this.repo.createTask({
      listId: task.listId,
      name: task.name,
      notes: task.notes,
      priority: task.priority,
      tagIds: [...task.tagIds],
      inProgress: false,
      completedAt: finishedAt,
      ...(tracked !== undefined ? { activeMs: tracked } : {}),
    });
    this.state.tasks.push(record);
    // Accepting a ritual makes it current and in-progress like anything else,
    // and finishing it has to put that down — otherwise it sits there flagged
    // as started, with a clock running, until tomorrow.
    // Captured BEFORE the patch below: patchTask mutates the mirror row in
    // place, so a read inside (or after) it sees the completed state — the
    // undo then "restores" today's mark and the ritual stays silently done,
    // eating every later completion as an already-done no-op.
    const priorDoneDay = task.ritualDoneDay;
    const priorSlots = task.ritualDoneSlots ? [...task.ritualDoneSlots] : undefined;
    // Per-window: append today's credited slot (dropping stale days — only
    // today's marks ever matter again); the day is "done" once every window is.
    // Nothing owed = the marks stay exactly as they are.
    const newSlots = perWindow && owed
      ? [...(priorSlots ?? []).filter((s) => s.startsWith(`${day}#`)), ritualSlot(day, credit)]
      : undefined;
    const dayComplete = owed && (!perWindow || newSlots!.length >= ritualWindows(task).length);
    // The forward patch, shared by the completion and its redo; `unstamp` is
    // its exact inverse, shared by the undo.
    const stamp: Partial<Task> = {
      ...(newSlots ? { ritualDoneSlots: newSlots } : {}),
      // Once-a-day rituals live on ritualDoneDay as always; a per-window ritual
      // sets it only when its LAST window lands (which also keeps a not-yet-
      // updated device reading the day as done).
      ...(dayComplete ? { ritualDoneDay: day } : {}),
      inProgress: false,
      startedAt: undefined,
      activeAccumulatedMs: undefined,
      // The countdown dies with the completion — a done ritual whose timebox
      // kept ticking would fire its alarm over a finished job.
      timeboxEndsAt: undefined,
    };
    const unstamp: Partial<Task> = {
      ritualDoneDay: priorDoneDay,
      ritualDoneSlots: priorSlots,
      inProgress: wasInProgress,
      startedAt: priorStartedAt,
      activeAccumulatedMs: priorAccumulated,
      timeboxEndsAt: priorTimebox,
    };
    await this.patchTask(task.id, stamp);

    // A ritual with nothing left owed today leaves the day's plan. Its row
    // stays open — rituals stamp the day, they don't close — so the queue
    // held it forever after completion (2026-08-19 report). A per-window
    // ritual with windows still to come keeps its place in line.
    const leavesQueue = this.state.queueIds.includes(task.id) && (dayComplete || !owed);
    if (leavesQueue) await this.removeFromQueue(task.id);

    const ritualOutcome = estimateOutcome({ estimateHours: task.estimateHours, activeMs: tracked });
    const ritualTiming = ritualOutcome ? ` · ${ritualOutcome.actual} — ${ritualOutcome.verdict}` : '';
    this.pushUndo(`Completed "${task.name || 'task'}"${ritualTiming}`, async () => {
      await this.removeTask(record.id, { silent: true });
      await this.patchTask(task.id, unstamp);
      // Back in line, at the end — the exact slot is not worth restoring.
      // writeQueue directly: the silent primitive, no ceremony (no egg).
      if (leavesQueue && !this.state.queueIds.includes(task.id)) {
        await this.writeQueue([...this.state.queueIds, task.id]);
      }
    }, async () => {
      // Resurrect the SAME history record (the undo only tombstoned it) and
      // re-stamp the day — identical state to the original completion.
      await this.restoreTask(record.id);
      await this.patchTask(task.id, stamp);
      if (leavesQueue) await this.removeFromQueue(task.id);
    });

    if (this.state.currentTask?.taskId === task.id) await this.clearCurrent();
    // Both events, in this order: the ritual's own voice gets first claim on
    // the presentation slot, while the plain completion event still runs the
    // engine's bookkeeping (streak, daily tally) — those must not know the
    // difference between kinds of finishing. The quiet-time governor makes a
    // double presentation impossible.
    this.fireEgg('ritualCompleted');
    this.fireEgg('taskCompleted');
    const kept = this.state.tasks.filter(
      (t) => !t.deleted && isRitualTask(t) &&
        (t.ritualDoneDay === day || (t.ritualDoneSlots ?? []).some((s) => s.startsWith(`${day}#`))),
    );
    if (kept.length >= 3) this.grantUnlockAndShow('clockwork');
    if (!opts.bulk && this.state.settings.autoSelectNext) await this.drawNext();
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
    if (task && isRitualTask(task)) return this.completeRitual(task, opts);
    const wasCurrent = this.state.currentTask?.taskId === id;
    // Snapshot enough to put things back exactly as they were.
    const before = task
      ? {
          name: task.name, inProgress: task.inProgress, recurrenceId: task.recurrenceId,
          startedAt: task.startedAt, activeMs: task.activeMs,
          timeboxEndsAt: task.timeboxEndsAt,
        }
      : null;
    const priorCurrent = this.state.currentTask;
    // Everything the completion teaches its template, captured so the undo can
    // unteach it — otherwise an undone completion leaves a phantom sample in
    // the rolling average and a spawn armed for a task that never finished.
    const priorTpl = before?.recurrenceId
      ? this.state.templates.find((t) => t.id === before.recurrenceId)
      : undefined;
    const priorSpawnAt = priorTpl?.nextSpawnAt;
    const priorAvg = priorTpl?.avgActiveMs;
    const priorInstances = priorTpl?.completedInstances;

    const finishedAt = Date.now();
    // Time counts ONLY when finishing something you were actively working on.
    // Ticking it off the list — or completing it after pausing — records nothing,
    // because that stretch was never tracked to completion. And a stretch under
    // MIN_TRACKED_MS also records nothing: completing seconds after pickup (or
    // after a clock reset) means the work happened off the books.
    const rawTracked = task?.inProgress && task.startedAt !== undefined
      ? (task.activeAccumulatedMs ?? 0) + (finishedAt - task.startedAt)
      : undefined;
    const tracked = rawTracked !== undefined && rawTracked >= MIN_TRACKED_MS ? rawTracked : undefined;

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
    // Estimate vs. reality, splashed at the moment it can teach something.
    const outcome = task ? estimateOutcome({ estimateHours: task.estimateHours, activeMs: tracked }) : null;
    const timingNote = outcome ? ` · ${outcome.actual} — ${outcome.verdict}` : '';
    this.pushUndo(`Completed "${before?.name || 'task'}"${freedNote}${timingNote}`, async () => {
      // Put the clock back too, or an undone completion silently forgets how
      // long the task had already been running.
      await this.patchTask(id, {
        completedAt: undefined,
        inProgress: before?.inProgress ?? false,
        startedAt: before?.startedAt,
        activeMs: before?.activeMs,
        // A countdown that was running comes back exactly as it was — if it
        // expired during the undo gap, the alert firing now is the truth.
        timeboxEndsAt: before?.timeboxEndsAt,
      });
      // Un-arm any recurrence this completion scheduled, and unteach the
      // template what the completion taught it (average + instance count).
      if (before?.recurrenceId) {
        await this.updateRecurring(before.recurrenceId, {
          nextSpawnAt: priorSpawnAt,
          avgActiveMs: priorAvg,
          completedInstances: priorInstances,
        });
      }
      if (wasCurrent) {
        this.state.currentTaskUpdatedAt = await this.repo.setCurrentTask(priorCurrent);
        this.state.currentTask = priorCurrent;
      }
    }, async () => {
      // Redo = the same state changes the completion made, re-derived from
      // the captured snapshot (the undo restored the priors, so the teaching
      // formulas below start from exactly where they started the first time).
      await this.patchTask(id, {
        completedAt: finishedAt,
        inProgress: false,
        startedAt: undefined,
        timeboxEndsAt: undefined,
        ...(tracked && tracked > 0 ? { activeMs: tracked } : {}),
      });
      if (before?.recurrenceId) {
        const tpl = this.state.templates.find((t) => t.id === before.recurrenceId && !t.deleted);
        if (tpl) {
          const teach: Partial<RecurrenceTemplate> = {};
          if (tracked !== undefined && tracked > 0) {
            const n = tpl.completedInstances ?? 0;
            const mean = tpl.avgActiveMs ?? 0;
            teach.avgActiveMs = Math.round((mean * n + tracked) / (n + 1));
            teach.completedInstances = n + 1;
          }
          // Re-armed from NOW, not the original moment: "come back X after
          // done" counts from when the task most recently became done.
          if (!tpl.paused) {
            const next = scheduleAfterCompletion(tpl, new Date());
            if (next !== null) teach.nextSpawnAt = next;
          }
          if (Object.keys(teach).length > 0) await this.updateRecurring(tpl.id, teach);
        }
      }
      if (wasCurrent) await this.clearCurrent();
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
      if (tpl.mode.kind === 'chance') {
        // Peppered: completion resets the climb, and the task returns to the
        // pool NOW (the arm above is for this very moment — sweep it in).
        // Honest limit: undoing this completion leaves the fresh copy too
        // (skip-if-open stops further spawns; the deterministic spawn id
        // means at most one extra row, deletable) — accepted trade for the
        // mechanic's whole point being immediacy (2026-08-20 ask).
        resetPepperRolls(tpl.id);
        void this.runSpawnSweep();
      }
    }
    // Auto-select (2026-07-26 request): finishing THE current task rolls the next one.
    if (wasCurrent && !opts.bulk && this.state.settings.autoSelectNext) await this.drawNext();

  }

  /**
   * Roll the next task on the user's behalf. Shared so every automatic draw
   * applies the same rules the randomizer screen does — in particular a ritual
   * outside its window must never be handed to you, and one inside its window
   * should be handed to you first.
   */
  /**
   * The roll-next card's action (2026-08-01 ask): skip the randomizer's
   * accept screen entirely — draw under the full ruleset and take the result
   * straight into the current-task slot. Don't like it? The card's own
   * buttons put it back and this can run again. Returns false when the pool
   * is empty so the caller can show WHY instead of doing nothing.
   */
  /**
   * The chance-mode ("peppered") tasks currently able to roll, with each
   * one's live percentage: base + rolls-on-this-device × boost, capped at
   * 100 (see RecurrenceMode kind 'chance' and state/pepperRolls).
   */
  pepperCandidates(): Array<{ taskId: string; tplId: string; chancePct: number }> {
    const out: Array<{ taskId: string; tplId: string; chancePct: number }> = [];
    for (const t of this.state.tasks) {
      if (t.deleted || t.completedAt !== undefined || !t.recurrenceId) continue;
      const tpl = this.state.templates.find((x) => x.id === t.recurrenceId && !x.deleted && !x.paused);
      if (!tpl || tpl.mode.kind !== 'chance') continue;
      const { baseChance, perRollBoost } = tpl.mode;
      out.push({
        taskId: t.id,
        tplId: tpl.id,
        chancePct: Math.min(100, baseChance + pepperRollsFor(tpl.id) * perRollBoost),
      });
    }
    return out;
  }

  /** Every draw that served a card ages every pepper — see state/pepperRolls. */
  agePeppers(): void {
    bumpPepperRolls(this.state.templates
      .filter((t) => !t.deleted && !t.paused && t.mode.kind === 'chance')
      .map((t) => t.id));
  }

  async rollStraightIn(): Promise<boolean> {
    const before = this.state.currentTask?.taskId;
    await this.drawNext();
    return this.state.currentTask?.taskId !== undefined
      && this.state.currentTask.taskId !== before;
  }

  private async drawNext(): Promise<void> {
    const now = new Date();
    const next = drawTask(
      this.state.tasks, this.state.settings, now, Math.random,
      {
        excludeIds: [
          ...ritualExclusions(this.state.tasks, this.state.settings, now),
          ...archivedTaskIds(this.state.tasks, this.state.lists),
          // Locked lists' tasks never draw while locked — handing one to the
          // user would read its name out loud.
          ...lockedTaskIds(this.state.tasks, this.state.lists, lockSession.unlocked),
        ],
        queueFirst: liveQueueIds(this.state.queueIds, this.state.tasks),
        dueFirst: dueRitualIds(this.state.tasks, this.state.settings, now),
        peppers: this.pepperCandidates(),
      },
      undefined,
      withRitualLifts(
        blockLifts(this.state.tasks, this.state.settings, now), this.state.tasks, this.state.settings, now,
      ),
    );
    if (next) {
      this.agePeppers();
      await this.acceptTask(next.id);
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
      // A rule-bound copy regrows tomorrow (the rule is the commitment), so
      // its delete toast offers ending the rule outright (2026-08-11 ask).
      const tpl = task?.recurrenceId
        ? this.state.templates.find((t) => t.id === task.recurrenceId && !t.deleted)
        : undefined;
      this.pushUndo(`Deleted "${task?.name || 'task'}"`, () => this.restoreTask(id),
        // Silent: the entry shuttling between the stacks IS the undo record.
        () => this.removeTask(id, { silent: true }),
        tpl ? { label: 'stop repeating too', run: () => this.stopRuleFromToast(tpl.id) } : undefined);
    }
  }

  /** Same duplicate guard as restoreList — see the note there. */
  async restoreTask(id: string): Promise<void> {
    await this.repo.updateTask(id, { deleted: false });
    const trashed = this.trashTasks.get(id);
    this.trashTasks.delete(id);
    const existing = this.state.tasks.find((t) => t.id === id);
    if (existing) existing.deleted = false;
    else if (trashed) {
      trashed.deleted = false;
      this.state.tasks.push(trashed);
    }
    this.requestSync();
  }

  /**
   * Materialize an accepted bonus draw as a real task — in ITS list, not
   * whichever list happened to be touched last. The vessel is found or created
   * per category, flagged `generated`, and needs no triage: nobody should be
   * asked to review a task the dice wrote.
   */
  async materializeGeneratedTask(name: string, category = 'self-care'): Promise<Task> {
    let list = this.state.lists.find((l) => l.generated === true && l.title === category);
    if (!list) {
      list = await this.repo.createList({ title: category, generated: true });
      this.state.lists.push(list);
    }
    const task = this.addTaskEager(list.id);
    await this.patchTask(task.id, { name, priority: 'high', needsReview: false });
    return task;
  }

  // ── the triage sweep ─────────────────────────────────────────────────────

  /**
   * One sweep decision. Routed through the same store operations the rest of
   * the app uses, so every rule (undo entries, recurrence, sync, delight)
   * behaves exactly as it would if the user had done the thing by hand:
   * - keep: reviewed, optionally re-prioritised
   * - someday: reviewed + sunk to the bottom tier
   * - later: reviewed + out of the draw until the chosen day's rollover
   * - done: the ordinary completion path ("I already did this")
   * - delete: the ordinary (undoable) removal
   * Returns what it changed, so the sweep screen can offer "put it back".
   */
  async applySweepVerdict(
    id: string,
    verdict: SweepVerdict,
    opts: { priority?: Task['priority']; snoozeDays?: number; listId?: string } = {},
  ): Promise<{ before: Partial<Task> } | null> {
    const task = this.state.tasks.find((t) => t.id === id);
    if (!task) return null;
    const before: Partial<Task> = {
      needsReview: task.needsReview, priority: task.priority,
      notTodayUntil: task.notTodayUntil, listId: task.listId,
    };

    if (verdict === 'delete') {
      await this.removeTask(id); // its own undo toast
    } else if (verdict === 'done') {
      // bulk: a sweep is not "finishing the current task" — no auto-draw.
      await this.completeTask(id, { bulk: true });
    } else if (verdict === 'someday') {
      await this.patchTask(id, { priority: 'someday', needsReview: false });
    } else if (verdict === 'later') {
      await this.patchTask(id, {
        notTodayUntil: snoozeUntilTs(opts.snoozeDays ?? 7, this.state.settings.rolloverHour, new Date()),
        needsReview: false,
      });
    } else {
      // Re-filing into a better list IS a keep — deciding where something
      // belongs is the whole review. One gesture moves and clears the flag.
      await this.patchTask(id, {
        needsReview: false,
        ...(opts.priority && opts.priority !== task.priority ? { priority: opts.priority } : {}),
        ...(opts.listId && opts.listId !== task.listId ? { listId: opts.listId } : {}),
      });
    }
    this.fireEgg('sweepActed');
    return { before };
  }

  /** The sweep screen's "put it back" for verdicts that are plain patches. */
  async revertSweepVerdict(id: string, before: Partial<Task>): Promise<void> {
    await this.patchTask(id, before);
  }

  // ── undo ─────────────────────────────────────────────────────────────────

  /**
   * Record a reversible action and surface it as a tappable toast.
   *
   * `redo` re-applies the action's STATE changes after an undo — never its
   * ceremony (delight events, unlock grants, auto-draws happened once, when
   * the user really did the thing). Sites that can't express one simply
   * aren't redoable, and the stack breaks the redo chain there instead of
   * skipping them.
   */
  private pushUndo(
    label: string,
    run: () => Promise<void>,
    redo?: () => Promise<void>,
    extra?: { label: string; run: () => void },
  ): void {
    const entry = undoStack.push(label, run, redo);
    toast.show(label, () => void undoStack.undoEntry(entry).catch(() => {
      toast.show('Undo failed — nothing was lost, try again', () => {});
    }), 5000, extra);
  }

  /**
   * Cmd/Ctrl+Z. Returns what was undone, for the confirmation toast.
   * A failed undo re-arms itself (the stack put the entry back) — the toast
   * here is the only signal the user gets, so it must not be skipped.
   */
  async undoLast(): Promise<string | null> {
    try {
      return await undoStack.undo();
    } catch {
      toast.show('Undo failed — nothing was lost, try again', () => {});
      return null;
    }
  }

  /** Cmd/Ctrl+Shift+Z. Returns what was redone, for the confirmation toast. */
  async redoLast(): Promise<string | null> {
    try {
      return await undoStack.redo();
    } catch {
      toast.show('Redo failed — nothing was lost, try again', () => {});
      return null;
    }
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
    // Displacement is a put-down for whoever was current: their box stops
    // with their work, or its alarm would fire for a task nobody is doing.
    const displaced = this.state.currentTask?.taskId;
    if (displaced && displaced !== taskId) {
      const d = this.state.tasks.find((x) => x.id === displaced);
      if (d && !d.deleted && d.completedAt === undefined && d.timeboxEndsAt !== undefined) {
        await this.patchTask(displaced, { timeboxEndsAt: undefined });
      }
    }
    const ref = { taskId, acceptedAt: Date.now() };
    const currentStamp = await this.repo.setCurrentTask(ref);
    this.state.currentTask = ref;
    this.state.currentTaskUpdatedAt = currentStamp;
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
    // Captured BEFORE any patch (the mirror mutates in place): snoozing a
    // current task stops its box via clearCurrent, and undo puts it back.
    const priorTimebox = task?.timeboxEndsAt;
    const priorCurrent = this.state.currentTask;
    const wasCurrent = priorCurrent?.taskId === taskId;

    await this.patchTask(taskId, {
      notTodayUntil: nextRolloverTs(Date.now(), this.state.settings.rolloverHour),
    });
    if (wasCurrent) await this.clearCurrent();
    this.fireEgg('drawSkipped');

    this.pushUndo(`Snoozed "${task?.name || 'task'}"`, async () => {
      await this.patchTask(taskId, {
        notTodayUntil: priorSnooze,
        ...(wasCurrent ? { timeboxEndsAt: priorTimebox } : {}),
      });
      if (wasCurrent) {
        this.state.currentTaskUpdatedAt = await this.repo.setCurrentTask(priorCurrent);
        this.state.currentTask = priorCurrent;
      }
    }, async () => {
      // The horizon is recomputed at redo time — "until the next rollover"
      // means the next one from NOW, not from when the snooze first happened.
      await this.patchTask(taskId, {
        notTodayUntil: nextRolloverTs(Date.now(), this.state.settings.rolloverHour),
      });
      if (wasCurrent) await this.clearCurrent();
    });
  }

  async clearCurrent(): Promise<void> {
    /*
      Putting the task down stops its timebox — pauseWork's own principle:
      the clock stops with the work. Without this, the card's ✕ left the box
      ticking and the app-wide watcher (built precisely to fire on every
      screen) faithfully alarmed for a task already walked away from
      (2026-08-06 report). Guarded so completeTask's tail — which clears the
      box itself first — costs no extra write here.
    */
    const prior = this.state.currentTask?.taskId;
    if (prior) {
      const t = this.state.tasks.find((x) => x.id === prior);
      if (t && !t.deleted && t.completedAt === undefined && t.timeboxEndsAt !== undefined) {
        await this.patchTask(prior, { timeboxEndsAt: undefined });
      }
    }
    const clearedStamp = await this.repo.setCurrentTask(null);
    this.state.currentTask = null;
    this.state.currentTaskUpdatedAt = clearedStamp;
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
   * "I forgot to put this down" (2026-08-08 ask): restart the running clock
   * without touching anything else. The stale stretch — running AND banked —
   * is discarded, not shrunk: the true time is unknowable, and a made-up
   * number would teach the estimate averages a lie. Pairs with
   * MIN_TRACKED_MS at completion, so reset-then-finish records nothing.
   */
  async resetWorkClock(id: string): Promise<void> {
    const task = this.state.tasks.find((t) => t.id === id);
    if (!task) return;
    if (task.startedAt === undefined && task.activeAccumulatedMs === undefined) return;
    const prior = { startedAt: task.startedAt, activeAccumulatedMs: task.activeAccumulatedMs };
    const fresh = {
      // Still being worked on = the clock restarts now; put down = it just clears.
      startedAt: task.inProgress ? Date.now() : undefined,
      activeAccumulatedMs: undefined,
    };
    // Armed before the mutation, same as every undo here.
    this.pushUndo(`Reset the clock on "${task.name || 'task'}"`,
      () => this.patchTask(id, prior),
      () => this.patchTask(id, fresh));
    await this.patchTask(id, fresh);
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
    // Every timebox start asks now rather than at fire time — this also covers
    // boxes auto-started by accepting a task with a default. Synchronously,
    // before any await, to stay inside whatever user gesture brought us here.
    if (minutes > 0) ensureNotificationPermission();
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

  /**
   * Re-home a recurring rule AND its open spawned copy in one move
   * (2026-07-29 ask — reorganising rules is pointless if the live copy stays
   * behind). Completed history keeps the list it happened in.
   */
  async moveRecurringToList(id: string, listId: string): Promise<void> {
    await this.updateRecurring(id, { listId });
    const open = this.state.tasks.find(
      (t) => t.recurrenceId === id && !t.deleted && t.completedAt === undefined,
    );
    if (open && open.listId !== listId) await this.patchTask(open.id, { listId });
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

  /**
   * The delete toast's "stop repeating too" (2026-08-11 ask). Ends the rule
   * with its own undo toast — same restore shape as RecurringView's removal,
   * guarded against the push-twice sync race (see restoreList).
   */
  private stopRuleFromToast(tplId: string): void {
    const tpl = this.state.templates.find((t) => t.id === tplId);
    if (!tpl) return;
    const snapshot = $state.snapshot(tpl) as RecurrenceTemplate;
    void this.removeRecurring(tplId).then(() => {
      toast.show(`Stopped repeating "${snapshot.name || 'task'}"`, () => {
        void this.updateRecurring(snapshot.id, { deleted: false }).then(() => {
          if (!this.state.templates.some((t) => t.id === snapshot.id)) {
            this.state.templates.push({ ...snapshot, deleted: false });
          }
        });
      });
    });
  }

  /**
   * Write today's backlog measurement if this is the first run of the app-day
   * (see domain/stats.BurdenLedger for why measurements exist at all). Rides
   * the spawn-sweep triggers — boot, returning to the app, the 4am timer — so
   * the reading lands as close to the rollover as this device ever gets; the
   * per-day earliest-wins merge lets whichever DEVICE measured first own the
   * day. Archived lists are excluded, same as every burden number.
   */
  private async recordBurdenSnapshot(now: Date): Promise<void> {
    const day = appDayKey(now, this.state.settings.rolloverHour);
    if (this.burdenLedger[day] !== undefined) return;
    const v = totalEstimateHours(burdenTasks(this.state.tasks, this.state.lists));
    this.burdenLedger = { ...this.burdenLedger, [day]: { v, at: now.getTime() } };
    await this.repo.setKv('burdenLedger', $state.snapshot(this.burdenLedger));
    this.requestSync();
  }

  /** Materialize due templates. Called from init, window focus, and the rollover timer. */
  /** Set while a sweep runs — two triggers can land near-simultaneously
   *  (init + visibility, or a rollover timer), and the second must not
   *  compute from state the first is mid-way through changing. */
  private spawnSweepInFlight = false;

  async runSpawnSweep(now: Date = new Date()): Promise<number> {
    if (this.spawnSweepInFlight) return 0;
    this.spawnSweepInFlight = true;
    try {
      return await this.runSpawnSweepBody(now);
    } finally {
      this.spawnSweepInFlight = false;
    }
  }

  private async runSpawnSweepBody(now: Date): Promise<number> {
    // Measure BEFORE spawning: today's recurring arrivals belong to "added
    // since yesterday", so the day's baseline must not already contain them.
    await this.recordBurdenSnapshot(now);
    /*
      Self-heal dormant templates before sweeping. The Things import shipped
      templates with no `nextSpawnAt`, and sweepSpawns skips unarmed rows — so
      an imported weekly rule could never spawn, ever. Arming here (rather
      than only at import) also heals every library imported before the fix.
      - Scheduled modes arm to their next cadence moment.
      - afterCompletion arms to the NEXT ROLLOVER only when no open copy
        exists: its normal resting state is unarmed-with-an-open-copy, but
        unarmed with NOTHING open is a rule waiting for a completion that
        cannot come. Deleting a rule's copy therefore regrows one — the RULE
        is the commitment — but not until tomorrow: arming to NOW made a
        deleted copy resurrect on the very next app open (2026-08-11 report,
        whack-a-mole), and a deletion means "not today" at minimum. The
        delete toast offers stopping the rule outright.
    */
    const openByRecurrence = new Set(
      this.state.tasks
        .filter((t) => !t.deleted && t.completedAt === undefined && t.recurrenceId)
        .map((t) => t.recurrenceId!),
    );
    // An archived (or deleted) list silences its rules — no healing, no
    // spawning — until the list comes back (2026-08-12 zombie report).
    const goneLists = new Set(
      this.state.lists.filter((l) => l.deleted || l.archived).map((l) => l.id));
    for (const tpl of this.state.templates) {
      if (tpl.deleted || tpl.paused || goneLists.has(tpl.listId) || tpl.nextSpawnAt !== undefined) continue;
      // Chance mode heals exactly like afterCompletion: its resting state is
      // unarmed-with-an-open-copy, and unarmed with NOTHING open is a rule
      // waiting for a completion that cannot come.
      const armed = tpl.mode.kind === 'afterCompletion' || tpl.mode.kind === 'chance'
        ? (openByRecurrence.has(tpl.id)
          ? null
          : nextRolloverTs(now.getTime(), this.state.settings.rolloverHour))
        : nextScheduledSpawn(tpl.mode, now, this.state.settings.rolloverHour);
      if (armed !== null) await this.updateRecurring(tpl.id, { nextSpawnAt: armed });
    }

    const res = sweepSpawns(this.state.templates, this.state.tasks, now, this.state.settings, this.state.lists);
    for (const draft of res.drafts) {
      // Deterministic ids mean the same occurrence can already be here —
      // synced in from another device mid-sweep. Same id = same row; skip.
      if (this.state.tasks.some((t) => t.id === draft.id)) continue;
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
  /** Set while an import is running — see the guard at the top of importThings. */
  private importInFlight = false;

  async importThings(
    mapped: MappedImport,
    opts: { countHistoryInTotals?: boolean } = {},
  ): Promise<MappedImport['counts']> {
    // ImportView's step guard blocks a double-tap, but it is per-component:
    // navigating away mid-import and starting a second one from a fresh view
    // would race two snapshot-read → id-mint → write cycles and duplicate
    // every new row. The store is the choke point, so the store refuses.
    if (this.importInFlight) throw new Error('an import is already running — give it a moment');
    this.importInFlight = true;
    try {
      return await this.importThingsInner(mapped, opts);
    } finally {
      this.importInFlight = false;
    }
  }

  private async importThingsInner(
    mapped: MappedImport,
    opts: { countHistoryInTotals?: boolean },
  ): Promise<MappedImport['counts']> {
    // Belt and braces against the bug class that has now bitten this codebase
    // three times: a reactive proxy reaching IndexedDB, which cannot
    // structured-clone one ("Proxy object could not be cloned"). The caller is
    // fixed not to send proxies, but this is the single choke point and the
    // failure lands mid-import on someone's whole task history, so it is worth
    // the one pass. A no-op on data that is already plain.
    mapped = $state.snapshot(mapped) as MappedImport;

    // Which incoming rows are Things-logbook history, captured BEFORE the
    // opt-in below erases the marker — the re-import reconciliation pass at
    // the bottom needs it either way.
    const historyUuids = new Set(
      mapped.tasks.filter((t) => t.importedHistory).map((t) => t.thingsUuid!));

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
      /**
       * Applied when a newer Things-side row replaces a matched local one:
       * carries forward everything the app knows that Things CANNOT express.
       * "Newest wins" is only honest for fields both sides can hold — wiping
       * a ritual config or tracked time because someone renamed the task on
       * their phone is destruction, not merging.
       */
      preserve?: (prior: T, next: T) => T,
    ): T[] => {
      const byThings = new Map(existing.filter((e) => e.thingsUuid).map((e) => [e.thingsUuid!, e]));
      const out = [...existing];
      for (const raw of incoming) {
        const prior = byThings.get(raw.thingsUuid!);
        const appId = prior?.id ?? nanoid();
        idMap.set(raw.thingsUuid!, appId);
        const finalize = () => ({ ...(remap ? remap(raw) : raw), id: appId });
        if (!prior) out.push(finalize());
        else if (raw.updatedAt > prior.updatedAt) {
          const next = finalize();
          out[out.indexOf(prior)] = preserve ? preserve(prior, next) : next;
        }
      }
      return out;
    };

    // App-native tags (no thingsUuid) added to a task locally must survive a
    // Things-side edit — the incoming tag list only knows Things tags.
    const appNativeTags = new Set(snap.tags.filter((t) => !t.thingsUuid).map((t) => t.id));

    const ref = (thingsUuid: string) => idMap.get(thingsUuid) ?? thingsUuid;
    // Order matters: lists/tags first so tasks/templates can resolve refs.
    snap.lists = upsert(snap.lists, mapped.lists, undefined, (prior, next) => ({
      ...next,
      // Everything a list learns in-app: layout, schedule, curation.
      sortMode: prior.sortMode, order: prior.order, archived: prior.archived,
      generated: prior.generated, activeFrom: prior.activeFrom, activeTo: prior.activeTo,
      hours: prior.hours, deadline: prior.deadline,
      urgentOverridesHours: prior.urgentOverridesHours, editedAt: prior.editedAt,
    }));
    snap.tags = upsert(snap.tags, mapped.tags, undefined, (prior, next) => ({
      ...next, colorIndex: prior.colorIndex, editedAt: prior.editedAt,
    }));
    snap.templates = upsert(snap.templates, mapped.templates, (t) => ({
      ...t, listId: ref(t.listId), tagIds: t.tagIds.map(ref),
    }), (prior, next) => ({
      ...next,
      nextSpawnAt: prior.nextSpawnAt, avgActiveMs: prior.avgActiveMs,
      completedInstances: prior.completedInstances,
      deadlineOffsetDays: prior.deadlineOffsetDays, timeboxMinutes: prior.timeboxMinutes,
      estimateHours: prior.estimateHours, editedAt: prior.editedAt,
    }));
    snap.tasks = upsert(snap.tasks, mapped.tasks, (t) => ({
      ...t,
      listId: ref(t.listId),
      tagIds: t.tagIds.map(ref),
      recurrenceId: t.recurrenceId ? ref(t.recurrenceId) : undefined,
    }), (prior, next) => ({
      ...next,
      // Rituals, planning, and time-tracking exist only in this app.
      ritual: prior.ritual, rituals: prior.rituals, ritualPerWindow: prior.ritualPerWindow,
      ritualDoneDay: prior.ritualDoneDay, ritualDoneSlots: prior.ritualDoneSlots,
      order: prior.order, estimateHours: prior.estimateHours,
      timeboxMinutes: prior.timeboxMinutes, timeboxEndsAt: prior.timeboxEndsAt,
      activeMs: prior.activeMs, activeAccumulatedMs: prior.activeAccumulatedMs,
      startedAt: prior.startedAt, inProgress: prior.inProgress,
      blockedBy: prior.blockedBy, notTodayUntil: prior.notTodayUntil,
      editedAt: prior.editedAt,
      // Once reviewed, always reviewed — a rename in Things is not new triage.
      needsReview: prior.needsReview === false ? false : next.needsReview,
      // A completion made HERE outranks an open copy from Things, which simply
      // never learned about it. Things-side completions still land normally.
      completedAt: next.completedAt ?? prior.completedAt,
      tagIds: [...new Set([
        ...next.tagIds,
        ...prior.tagIds.filter((tagId) => appNativeTags.has(tagId)),
      ])],
    }));

    // Re-imports used to make the count-history checkbox a one-shot: matched
    // rows only update when the Things side is NEWER, and re-importing the
    // same library never is — so toggling the checkbox did nothing (reported
    // as a review note). The flag is OUR classification, not a Things field,
    // so "newest wins" doesn't apply to it: align every history row with the
    // current choice, stamping only actual changes so they sync.
    const byId = new Map(snap.tasks.map((t) => [t.id, t]));
    for (const uuid of historyUuids) {
      const row = byId.get(idMap.get(uuid) ?? '');
      if (!row || row.completedAt === undefined) continue; // reopened here = a real task now
      const flag = opts.countHistoryInTotals ? undefined : true;
      if (row.importedHistory !== flag) {
        row.importedHistory = flag;
        // Strictly newer than the row's own stamp (the nextStamp clamp, in
        // miniature): a bare Date.now() can TIE the previous write within the
        // same millisecond, and a tie doesn't supersede at write time.
        row.updatedAt = Math.max(Date.now(), row.updatedAt + 1);
      }
    }

    await this.repo.replaceAll(snap);
    await this.refreshFromDisk();
    // Arm what just arrived (the sweep's self-heal) and materialize anything
    // already due — the import should hand over a LIVING library.
    await this.runSpawnSweep();
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

  private async patchTag(id: string, patch: Partial<Tag>): Promise<void> {
    await this.repo.updateTag(id, patch);
    const tag = this.state.tags.find((t) => t.id === id);
    if (tag) Object.assign(tag, patch, { updatedAt: Date.now() });
    this.requestSync();
  }

  /** Renaming re-labels every task wearing it — the tag id never changes. */
  async renameTag(id: string, name: string): Promise<void> {
    const trimmed = name.trim();
    if (!trimmed) return;
    await this.patchTag(id, { name: trimmed });
  }

  async recolorTag(id: string, colorIndex: number): Promise<void> {
    await this.patchTag(id, { colorIndex });
  }

  /**
   * Tombstone a tag WITHOUT rewriting the tasks that wear it.
   *
   * Those ids are left dangling on purpose. Every reader resolves a tag id
   * against the live tag list and skips what it cannot find, so a dangling id
   * is inert — and leaving it means deleting a tag costs one write instead of
   * one per task, which on a library this size is the difference between
   * instant and a visible stall. It also makes undo exact: put the tag back
   * and every task that wore it is wearing it again.
   */
  async removeTag(id: string): Promise<void> {
    const tag = this.state.tags.find((t) => t.id === id);
    await this.repo.softDelete('tags', id);
    this.state.tags = this.state.tags.filter((t) => t.id !== id);
    this.requestSync();
    this.pushUndo(`Deleted tag "${tag?.name || 'tag'}"`, () => this.restoreTag(id, tag),
      async () => {
        await this.repo.softDelete('tags', id);
        this.state.tags = this.state.tags.filter((t) => t.id !== id);
        this.requestSync();
      });
  }

  private async restoreTag(id: string, trashed: Tag | undefined): Promise<void> {
    await this.repo.updateTag(id, { deleted: false });
    const existing = this.state.tags.find((t) => t.id === id);
    if (existing) existing.deleted = false;
    else if (trashed) {
      trashed.deleted = false;
      this.state.tags.push(trashed);
    }
    this.requestSync();
  }

  /**
   * Delete several tags under ONE undo entry — the point of a "clear out the
   * unused ones" button is that changing your mind is a single tap, not N.
   */
  async removeTags(ids: string[]): Promise<void> {
    const trashed = ids
      .map((id) => this.state.tags.find((t) => t.id === id))
      .filter((t): t is Tag => t !== undefined);
    if (trashed.length === 0) return;
    for (const tag of trashed) await this.repo.softDelete('tags', tag.id);
    const gone = new Set(trashed.map((t) => t.id));
    this.state.tags = this.state.tags.filter((t) => !gone.has(t.id));
    this.requestSync();
    const label = trashed.length === 1
      ? `Deleted tag "${trashed[0]!.name}"`
      : `Deleted ${trashed.length} tags`;
    this.pushUndo(label, async () => {
      for (const tag of trashed) await this.restoreTag(tag.id, tag);
    }, async () => {
      for (const tag of trashed) await this.repo.softDelete('tags', tag.id);
      this.state.tags = this.state.tags.filter((t) => !gone.has(t.id));
      this.requestSync();
    });
  }

  /**
   * Fold `sourceId` into `targetId`: everything wearing the source ends up
   * wearing the target, and the source is tombstoned.
   *
   * Unlike a plain delete this HAS to rewrite the tasks — the whole point is
   * that the association survives, and it can only survive under the surviving
   * id. Undo restores each task's exact previous tag set rather than stripping
   * the target, so merging a tag a task already had is reversible too.
   */
  async mergeTags(sourceId: string, targetId: string): Promise<number> {
    if (sourceId === targetId) return 0;
    const source = this.state.tags.find((t) => t.id === sourceId);
    const target = this.state.tags.find((t) => t.id === targetId);
    if (!source || !target) return 0;

    // Both directions captured up front: `before` is what undo restores,
    // `after` is what the merge writes now and what a redo writes again.
    const affected = this.state.tasks
      .filter((t) => t.tagIds.includes(sourceId))
      .map((t) => {
        const before = [...t.tagIds];
        const after = before.filter((tagId) => tagId !== sourceId);
        if (!after.includes(targetId)) after.push(targetId);
        return { id: t.id, before, after };
      });

    for (const { id, after } of affected) {
      await this.patchTask(id, { tagIds: after });
    }
    await this.repo.softDelete('tags', sourceId);
    this.state.tags = this.state.tags.filter((t) => t.id !== sourceId);
    this.requestSync();

    this.pushUndo(`Merged "${source.name}" into "${target.name}"`, async () => {
      for (const { id, before } of affected) await this.patchTask(id, { tagIds: before });
      await this.restoreTag(sourceId, source);
    }, async () => {
      for (const { id, after } of affected) await this.patchTask(id, { tagIds: after });
      await this.repo.softDelete('tags', sourceId);
      this.state.tags = this.state.tags.filter((t) => t.id !== sourceId);
      this.requestSync();
    });
    this.grantUnlockAndShow('gardener');
    return affected.length;
  }
}

/** Module singleton the UI imports; tests construct their own instances. */
export const app = new AppStore();
