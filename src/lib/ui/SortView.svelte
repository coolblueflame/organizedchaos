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
  import { withoutArchived } from '../domain/archive';
  import { withoutLocked } from '../domain/lock';
  import { lock } from './lock.svelte';
  import { eligibleForDraw } from '../domain/randomizer';
  import { ritualExclusions } from '../domain/ritual';
  import { tasksBlockedByHours } from '../domain/schedule';
  import { closeOnOutsideOrEscape } from './dismiss';

  let { mode }: { mode: 'date' | 'priority' | 'tag' } = $props();

  let editingTaskId = $state<string | null>(null);

  /*
    "Available now" (2026-07-29 ask): a screen full of max-priority rituals
    waiting for their windows is clutter when the question is "what could I do
    RIGHT NOW". The filter applies the randomizer's own eligibility — rituals
    outside their window, lists off the clock, blocked and snoozed tasks all
    drop. Sticky across visits: it is a way of reading the screen, not a
    one-off query.
  */
  let availableOnly = $state(
    typeof localStorage !== 'undefined' && localStorage.getItem('oc-sort-available') === '1',
  );
  function toggleAvailable() {
    availableOnly = !availableOnly;
    localStorage.setItem('oc-sort-available', availableOnly ? '1' : '0');
  }

  $effect(() => closeOnOutsideOrEscape(() => editingTaskId !== null, () => (editingTaskId = null)));

  const titles = { date: 'By Date', priority: 'By Priority', tag: 'By Tag' } as const;

  const groups = $derived.by(() => {
    const now = new Date();
    // Archived lists' tasks are out of every global view — that is what
    // archiving means. They stay reachable via search and the shelf itself.
    let tasks = withoutLocked(
      withoutArchived(app.state.tasks, app.state.lists), app.state.lists, lock.unlocked);
    if (availableOnly) {
      tasks = eligibleForDraw(tasks, now, {
        excludeIds: [
          ...ritualExclusions(app.state.tasks, app.state.settings, now),
          ...tasksBlockedByHours(app.state.tasks, app.state.lists, app.state.settings, now),
        ],
      });
    }
    if (mode === 'date') return groupByDate(tasks, app.state.settings, now);
    if (mode === 'tag') return groupByTag(tasks, app.state.tags, app.state.settings, now);
    return groupByPriority(tasks, app.state.settings, now);
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
    <button class="sub" class:on={availableOnly} data-testid="sort-available-now"
      title="hide rituals outside their window, off-hours lists, blocked and snoozed tasks"
      onclick={toggleAvailable}>{availableOnly ? '● now' : '○ now'}</button>
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
  .sub.on { color: var(--acc-green); border-color: var(--acc-green); }
</style>
