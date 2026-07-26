<!--
  Single-list screen (spec §6): sorted task groups (mode remembered per list),
  inline new-task that opens expanded, checkbox/delete on every row.
  Phase 3 adds the list-scoped randomizer button to the header.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { groupByDate, groupByPriority, groupByTag } from '../domain/views';
  import type { SortMode } from '../domain/types';
  import TaskRow from './TaskRow.svelte';

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

  async function cycleSort() {
    if (!list) return;
    await app.setListSort(list.id, nextMode[list.sortMode]);
  }

  async function newTask() {
    const task = await app.addTask(id);
    editingTaskId = task.id;
  }

  function toggle(taskId: string) {
    editingTaskId = editingTaskId === taskId ? null : taskId;
  }
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>{list?.title ?? '…'}</h1>
    <button class="sort" data-testid="list-sort" onclick={cycleSort}>
      sort: {list?.sortMode ?? 'priority'}
    </button>
  </header>

  <section class="groups">
    {#each groups as group (group.key)}
      <h2 class="group-header">{group.label}</h2>
      {#each group.tasks as task (group.key + task.id)}
        <TaskRow {task} expanded={editingTaskId === task.id} ontoggle={() => toggle(task.id)} />
      {/each}
    {/each}
    {#if groups.length === 0}
      <p class="empty">// nothing here yet</p>
    {/if}
  </section>

  <button class="new-task" data-testid="new-task" onclick={newTask}>+ new todo</button>
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; flex: 1; }
  .sort {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 6px;
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.7rem;
    padding: 6px 10px; cursor: pointer;
  }
  .groups { display: flex; flex-direction: column; gap: 6px; }
  .group-header {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 14px 0 2px; font-weight: 600;
  }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; }
  .new-task {
    margin-top: 16px; width: 100%; background: none; border: 1px dashed var(--line);
    border-radius: 8px; color: var(--dim); font-family: var(--font-mono);
    font-size: 0.85rem; padding: 12px; cursor: pointer; text-align: left;
  }
  .new-task:hover { color: var(--acc-green); border-color: var(--acc-green); }
</style>
