<!--
  Global sort views (spec §6): all open tasks across every list, grouped by
  date / priority / tag. Tag view intentionally duplicates multi-tag tasks in
  each of their sections. Rows are full TaskRows — complete/delete/edit work here.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { groupByDate, groupByPriority, groupByTag } from '../domain/views';
  import TaskRow from './TaskRow.svelte';

  let { mode }: { mode: 'date' | 'priority' | 'tag' } = $props();

  let editingTaskId = $state<string | null>(null);

  const titles = { date: 'By Date', priority: 'By Priority', tag: 'By Tag' } as const;

  const groups = $derived.by(() => {
    const now = new Date();
    if (mode === 'date') return groupByDate(app.state.tasks, app.state.settings, now);
    if (mode === 'tag') return groupByTag(app.state.tasks, app.state.tags, app.state.settings, now);
    return groupByPriority(app.state.tasks, app.state.settings, now);
  });
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>{titles[mode]}</h1>
  </header>

  <section class="groups">
    {#each groups as group (group.key)}
      <h2 class="group-header">{group.label}</h2>
      {#each group.tasks as task (group.key + task.id)}
        <TaskRow {task} showList expanded={editingTaskId === task.id}
          ontoggle={() => (editingTaskId = editingTaskId === task.id ? null : task.id)} />
      {/each}
    {/each}
    {#if groups.length === 0}
      <p class="empty">// nothing to sort yet</p>
    {/if}
  </section>
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .groups { display: flex; flex-direction: column; gap: 6px; }
  .group-header {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 14px 0 2px; font-weight: 600;
  }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; }
</style>
