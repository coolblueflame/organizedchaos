<!--
  Global sort views (spec §6): all open tasks across every list, grouped by
  date / priority / tag. Tag view intentionally duplicates multi-tag tasks in
  each of their sections. Rows are full TaskRows — complete/delete/edit work here.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import {
    groupByDate, groupByPriority, groupByTag, subSortGroups,
    SUB_SORT_LABELS, type SubSort,
  } from '../domain/views';
  import GroupedTasks from './GroupedTasks.svelte';
  import { closeOnOutsideOrEscape } from './dismiss';

  let { mode }: { mode: 'date' | 'priority' | 'tag' } = $props();

  let editingTaskId = $state<string | null>(null);

  $effect(() => closeOnOutsideOrEscape(() => editingTaskId !== null, () => (editingTaskId = null)));

  const titles = { date: 'By Date', priority: 'By Priority', tag: 'By Tag' } as const;

  const groups = $derived.by(() => {
    const now = new Date();
    if (mode === 'date') return groupByDate(app.state.tasks, app.state.settings, now);
    if (mode === 'tag') return groupByTag(app.state.tasks, app.state.tags, app.state.settings, now);
    return groupByPriority(app.state.tasks, app.state.settings, now);
  });

  let subSort = $state<SubSort>('smart');
  const SUB_CYCLE: SubSort[] = ['smart', 'alpha', 'created', 'newest'];
  const cycleSubSort = () => {
    subSort = SUB_CYCLE[(SUB_CYCLE.indexOf(subSort) + 1) % SUB_CYCLE.length]!;
  };
  const sortedGroups = $derived(subSortGroups(groups, subSort));
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>{titles[mode]}</h1>
    <button class="sub" data-testid="sort-subsort" onclick={cycleSubSort}
      title="order within each group">↳ {SUB_SORT_LABELS[subSort]}</button>
    {#if mode === 'tag'}
      <button class="sub" data-testid="sort-manage-tags"
        onclick={() => navigate({ name: 'tags' })}>manage</button>
    {/if}
  </header>

  <GroupedTasks groups={sortedGroups} {mode} showList bind:editingTaskId />
  {#if groups.length === 0}
    <p class="empty">// nothing to sort yet</p>
  {/if}
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; }
</style>
