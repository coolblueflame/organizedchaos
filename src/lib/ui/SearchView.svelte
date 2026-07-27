<!--
  Search across everything: live tasks first, finished ones after in a dimmer
  block with their completion dates. Results are live as you type.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { searchTasks } from '../domain/search';
  import { searchQuery } from './searchState.svelte';
  import TaskRow from './TaskRow.svelte';
  import { closeOnOutsideOrEscape } from './dismiss';

  let inputEl = $state<HTMLInputElement | null>(null);
  let editingTaskId = $state<string | null>(null);

  const results = $derived(
    searchTasks(app.state.tasks, searchQuery.value, app.state.settings, new Date()),
  );
  const nothing = $derived(
    searchQuery.value.trim().length > 0 &&
    results.open.length === 0 && results.completed.length === 0,
  );

  $effect(() => {
    inputEl?.focus();
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
    <h2 class="section">to do <span class="count">{results.open.length}</span></h2>
    <section class="rows">
      {#each results.open as task (task.id)}
        <TaskRow {task} showList expanded={editingTaskId === task.id}
          ontoggle={() => openTask(task.id)} />
      {/each}
    </section>
  {/if}

  {#if results.completed.length > 0}
    <h2 class="section done-header">done <span class="count">{results.completed.length}</span></h2>
    <section class="rows done" data-testid="search-completed">
      {#each results.completed as task (task.id)}
        <TaskRow {task} showList completedMode showCompletedAt ontoggle={() => {}} />
      {/each}
    </section>
  {/if}

  {#if nothing}
    <p class="empty" data-testid="search-empty">// nothing matches "{searchQuery.value.trim()}"</p>
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
  .rows.done:hover { opacity: 0.8; }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; margin-top: 20px; }
</style>
