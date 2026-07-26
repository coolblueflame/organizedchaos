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
import { openDb } from '../storage/db';
import { Repo, type AppState } from '../storage/repo';

export class AppStore {
  state: AppState = $state({
    lists: [], tasks: [], tags: [], templates: [],
    currentTask: null, settings: { ...DEFAULT_SETTINGS },
  });
  ready = $state(false);

  private repo!: Repo;
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
    this.state.settings = loaded.settings;
    this.ready = true;
  }

  // ── lists ────────────────────────────────────────────────────────────────

  async addList(title: string, areaGroup?: string): Promise<List> {
    const list = await this.repo.createList({ title, areaGroup });
    this.state.lists.push(list);
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
    return task;
  }

  async patchTask(id: string, patch: Partial<Task>): Promise<void> {
    await this.repo.updateTask(id, patch);
    const task = this.state.tasks.find((t) => t.id === id);
    if (task) Object.assign(task, patch, { updatedAt: Date.now() });
  }

  async completeTask(id: string): Promise<void> {
    const task = this.state.tasks.find((t) => t.id === id);
    await this.patchTask(id, { completedAt: Date.now(), inProgress: false });
    if (this.state.currentTask?.taskId === id) {
      await this.repo.setCurrentTask(null);
      this.state.currentTask = null;
    }
    // Arm after-completion recurrence: "come back X after done" (spec §5).
    const tpl = task?.recurrenceId
      ? this.state.templates.find((t) => t.id === task.recurrenceId && !t.deleted && !t.paused)
      : undefined;
    if (tpl) {
      const next = scheduleAfterCompletion(tpl, new Date());
      if (next !== null) await this.updateRecurring(tpl.id, { nextSpawnAt: next });
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
  }

  async restoreTask(id: string): Promise<void> {
    await this.repo.updateTask(id, { deleted: false });
    const task = this.trashTasks.get(id);
    if (task) {
      task.deleted = false;
      this.state.tasks.push(task);
      this.trashTasks.delete(id);
    }
  }

  // ── draw lifecycle (spec §4) ─────────────────────────────────────────────

  /** Accepting a draw: task becomes THE current task and is flagged in-progress. */
  async acceptTask(taskId: string): Promise<void> {
    await this.patchTask(taskId, { inProgress: true });
    const ref = { taskId, acceptedAt: Date.now() };
    await this.repo.setCurrentTask(ref);
    this.state.currentTask = ref;
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
  }

  async clearCurrent(): Promise<void> {
    await this.repo.setCurrentTask(null);
    this.state.currentTask = null;
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
    await this.patchTask(taskId, { recurrenceId: tpl.id });
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
  }

  async removeRecurring(id: string): Promise<void> {
    await this.repo.softDelete('templates', id);
    this.state.templates = this.state.templates.filter((t) => t.id !== id);
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
    return res.drafts.length;
  }

  // ── tags ─────────────────────────────────────────────────────────────────

  async addTag(name: string, colorIndex: number): Promise<Tag> {
    const tag = await this.repo.createTag({ name, colorIndex });
    this.state.tags.push(tag);
    return tag;
  }
}

/** Module singleton the UI imports; tests construct their own instances. */
export const app = new AppStore();
