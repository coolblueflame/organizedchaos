<!--
  Search across everything: live tasks first, finished ones after in a dimmer
  block with their completion dates. Results are live as you type.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { searchTasks, searchTemplates } from '../domain/search';
  import { lockedListIds, withoutLocked } from '../domain/lock';
  import { lock } from './lock.svelte';
  import { describeRecurrence } from './recurrenceText';
  import { searchQuery } from './searchState.svelte';
  import TaskRow from './TaskRow.svelte';
  import { closeOnOutsideOrEscape } from './dismiss';
  import { adoptKeyboard } from './keyboardBridge';

  let inputEl = $state<HTMLInputElement | null>(null);
  let editingTaskId = $state<string | null>(null);

  /*
    The box updates instantly; the SCAN trails it by a beat. Searching a large
    library is a pass over every task, and running that between keystrokes meant
    the second letter had to wait for the first one's scan to finish — typing
    appeared to hang, then stopped registering entirely.
  */
  let scanned = $state(searchQuery.value);
  $effect(() => {
    const typed = searchQuery.value;
    const timer = setTimeout(() => (scanned = typed), 120);
    return () => clearTimeout(timer);
  });

  const results = $derived(
    searchTasks(withoutLocked(app.state.tasks, app.state.lists, lock.unlocked), scanned, app.state.settings, new Date()),
  );
  const tplResults = $derived.by(() => {
    // A locked list's recurring rules are as telling as its tasks.
    const locked = lockedListIds(app.state.lists, lock.unlocked);
    return searchTemplates(app.state.templates.filter((t) => !locked.has(t.listId)), scanned);
  });
  const nothing = $derived(
    scanned.trim().length > 0 &&
      results.openTotal === 0 && results.completedTotal === 0 && tplResults.length === 0,
  );
  /** True while the box is ahead of the results, so the count can't read as final. */
  const scanning = $derived(scanned !== searchQuery.value);

  $effect(() => {
    adoptKeyboard(inputEl); // takes over the keyboard the home tap primed
  });

  $effect(() => closeOnOutsideOrEscape(() => editingTaskId !== null, () => (editingTaskId = null)));

  function openTask(id: string) {
    editingTaskId = editingTaskId === id ? null : id;
    if (editingTaskId) void app.markReviewed(id);
  }
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <input
      class="search-input"
      data-testid="search-input"
      type="search"
      placeholder="search everything…"
      bind:this={inputEl}
      bind:value={searchQuery.value} />
  </header>

  {#if results.open.length > 0}
    <h2 class="section">to do <span class="count">{results.openTotal}</span></h2>
    <section class="rows">
      {#each results.open as task (task.id)}
        <TaskRow {task} showList expanded={editingTaskId === task.id}
          ontoggle={() => openTask(task.id)} />
      {/each}
    </section>
    {#if results.openTotal > results.open.length}
      <p class="more" data-testid="search-more">
        showing the first {results.open.length} — keep typing to narrow it down
      </p>
    {/if}
  {/if}

  {#if tplResults.length > 0}
    <!-- Between live and done (2026-07-29 ask): a rule can exist while no copy
         of it is currently alive, and it should still be findable. -->
    <h2 class="section tpl-header">recurring <span class="count">{tplResults.length}</span></h2>
    <section class="rows" data-testid="search-recurring">
      {#each tplResults as tpl (tpl.id)}
        <button class="tpl-row" data-testid="search-tpl-{tpl.id}"
          onclick={() => navigate({ name: 'recurring', tplId: tpl.id })}>
          <span class="tpl-name">{tpl.name || 'untitled'}</span>
          <span class="tpl-cadence">↻ {describeRecurrence(tpl.mode, tpl.deadlineOffsetDays)}</span>
        </button>
      {/each}
    </section>
  {/if}

  {#if results.completed.length > 0}
    <h2 class="section done-header">done <span class="count">{results.completedTotal}</span></h2>
    <section class="rows done" data-testid="search-completed">
      {#each results.completed as task (task.id)}
        <TaskRow {task} showList completedMode showCompletedAt
          expanded={editingTaskId === task.id}
          ontoggle={() => (editingTaskId = editingTaskId === task.id ? null : task.id)} />
      {/each}
    </section>
    {#if results.completedTotal > results.completed.length}
      <p class="more">showing the first {results.completed.length} of {results.completedTotal}</p>
    {/if}
  {/if}

  {#if scanning && results.openTotal === 0 && results.completedTotal === 0}
    <p class="empty">// searching…</p>
  {:else if nothing}
    <p class="empty" data-testid="search-empty">// nothing matches "{scanned.trim()}"</p>
  {:else if searchQuery.value.trim().length === 0}
    <p class="empty">// type to search names and notes across every list</p>
  {/if}
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  .search-input {
    flex: 1; background: var(--bg1); border: 1px solid var(--acc-blue); border-radius: 8px;
    color: var(--text); font-size: 1rem; padding: 10px 12px; outline: none;
  }
  .search-input::placeholder { color: var(--dim); }
  .section {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 16px 0 6px; font-weight: 600;
  }
  .count { opacity: 0.6; }
  .rows { display: flex; flex-direction: column; gap: 6px; }
  /* Finished work stays readable but visibly secondary. */
  .rows.done { opacity: 0.55; }
  @media (hover: hover) { .rows.done:hover { opacity: 0.8; } }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; margin-top: 20px; }
  .more {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    margin: 8px 2px 0; text-align: center;
  }
  .tpl-header { color: var(--acc-cyan); }
  .tpl-row {
    display: flex; flex-direction: column; align-items: flex-start; gap: 3px;
    width: 100%; text-align: left; cursor: pointer;
    background: var(--bg1); border: 1px solid color-mix(in srgb, var(--acc-cyan) 25%, var(--line));
    border-radius: 8px; padding: 9px 12px; color: var(--text);
  }
  @media (hover: hover) { .tpl-row:hover { background: var(--bg2); } }
  .tpl-name { font-size: 0.88rem; font-weight: 500; }
  .tpl-cadence { color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.68rem; }
</style>
