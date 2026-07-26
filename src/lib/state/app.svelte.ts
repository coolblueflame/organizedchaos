/**
 * The app's single state layer: a Svelte-5 runes mirror of AppState, with every
 * mutation flowing Repo-first (persist), then patching the mirror in place.
 * Screens import the `app` singleton and never touch Repo/Dexie directly.
 */
import {
  DEFAULT_SETTINGS,
  type List, type SortMode, type Tag, type Task,
} from '../domain/types';
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
    await this.patchTask(id, { completedAt: Date.now(), inProgress: false });
    if (this.state.currentTask?.taskId === id) {
      await this.repo.setCurrentTask(null);
      this.state.currentTask = null;
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

  // ── tags ─────────────────────────────────────────────────────────────────

  async addTag(name: string, colorIndex: number): Promise<Tag> {
    const tag = await this.repo.createTag({ name, colorIndex });
    this.state.tags.push(tag);
    return tag;
  }
}

/** Module singleton the UI imports; tests construct their own instances. */
export const app = new AppStore();
