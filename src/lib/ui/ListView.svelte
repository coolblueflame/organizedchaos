<!--
  Single-list screen (spec §6): sorted task groups (mode remembered per list),
  inline new-task that opens expanded, checkbox/delete on every row.
  Phase 3 adds the list-scoped randomizer button to the header.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import {
    groupByDate, groupByPriority, groupByTag, subSortGroups,
    SUB_SORT_LABELS, type SubSort,
  } from '../domain/views';
  import type { SortMode } from '../domain/types';
  import GroupedTasks from './GroupedTasks.svelte';
  import { closeOnOutsideOrEscape } from './dismiss';

  let { id }: { id: string } = $props();

  let editingTaskId = $state<string | null>(null);

  const list = $derived(app.state.lists.find((l) => l.id === id));
  const listTasks = $derived(app.state.tasks.filter((t) => t.listId === id));

  const nextMode: Record<SortMode, SortMode> = { priority: 'date', date: 'tag', tag: 'priority' };

  const groups = $derived.by(() => {
    const mode = list?.sortMode ?? 'priority';
    const now = new Date();
    if (mode === 'date') return groupByDate(listTasks, app.state.settings, now);
    if (mode === 'tag') return groupByTag(listTasks, app.state.tags, app.state.settings, now);
    return groupByPriority(listTasks, app.state.settings, now);
  });

  let subSort = $state<SubSort>('smart');
  const SUB_CYCLE: SubSort[] = ['smart', 'alpha', 'created', 'newest'];
  const cycleSubSort = () => {
    subSort = SUB_CYCLE[(SUB_CYCLE.indexOf(subSort) + 1) % SUB_CYCLE.length]!;
  };
  const sortedGroups = $derived(subSortGroups(groups, subSort));

  async function cycleSort() {
    if (!list) return;
    await app.setListSort(list.id, nextMode[list.sortMode]);
  }

  /**
   * Rapid entry (Things-style): a freshly created task that never got filled in
   * is discarded the moment you leave it — collapse, switch rows, Esc, or
   * navigate away. Nothing that was actually typed is ever thrown away.
   */
  async function stopEditing(): Promise<void> {
    const prev = editingTaskId;
    editingTaskId = null;
    if (prev) await app.discardIfPristine(prev);
  }

  async function newTask() {
    await stopEditing();
    const task = await app.addTask(id);
    editingTaskId = task.id;
  }

  function toggle(taskId: string) {
    if (editingTaskId === taskId) {
      void stopEditing();
      return;
    }
    const prev = editingTaskId;
    editingTaskId = taskId;
    // Deliberately opening a task counts as giving it the once-over.
    void app.markReviewed(taskId);
    if (prev) void app.discardIfPristine(prev);
  }

  /** Enter commits and opens the next one; Enter on an empty name ends the chain. */
  async function chainNext(currentName: string) {
    if (!currentName.trim()) {
      await stopEditing();
      return;
    }
    editingTaskId = null;
    const task = await app.addTask(id);
    editingTaskId = task.id;
  }

  // Leaving the screen with an untouched new task open discards it too.
  $effect(() => () => {
    if (editingTaskId) void app.discardIfPristine(editingTaskId);
  });

  // Click-outside and Escape both collapse the open task (discarding it if it
  // was never filled in).
  $effect(() => closeOnOutsideOrEscape(() => editingTaskId !== null, () => void stopEditing()));
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>{list?.title ?? '…'}</h1>
    <button class="dice" data-testid="list-randomize" aria-label="randomize from this list"
      onclick={() => navigate({ name: 'randomizer', listId: id })}>🎲</button>
    <button class="sort" data-testid="list-sort" onclick={cycleSort}>
      sort: {list?.sortMode ?? 'priority'}
    </button>
    <button class="sort" data-testid="list-subsort" onclick={cycleSubSort}
      title="order within each group">
      ↳ {SUB_SORT_LABELS[subSort]}
    </button>
  </header>

  <GroupedTasks
    groups={sortedGroups}
    mode={list?.sortMode ?? 'priority'}
    bind:editingTaskId
    onenter={(name) => void chainNext(name)} />
  {#if groups.length === 0}
    <p class="empty">// nothing here yet</p>
  {/if}

  <button class="new-task" data-testid="new-task" onclick={newTask}>+ new todo</button>
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; flex: 1; }
  .dice {
    background: none; border: none; font-size: 1.1rem; cursor: pointer; padding: 4px 6px;
    filter: grayscale(0.3);
  }
  .dice:hover { filter: none; transform: scale(1.1); }
  .sort {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 6px;
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.7rem;
    padding: 6px 10px; cursor: pointer;
  }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; }
  .new-task {
    margin-top: 16px; width: 100%; background: none; border: 1px dashed var(--line);
    border-radius: 8px; color: var(--dim); font-family: var(--font-mono);
    font-size: 0.85rem; padding: 12px; cursor: pointer; text-align: left;
  }
  .new-task:hover { color: var(--acc-green); border-color: var(--acc-green); }
</style>
