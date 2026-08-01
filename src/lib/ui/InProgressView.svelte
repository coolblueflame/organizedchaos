<!-- All open tasks flagged in-progress (spec §6). -->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { withoutLocked } from '../domain/lock';
  import { lock } from './lock.svelte';
  import { navigate } from './router.svelte';
  import { openTasks } from '../domain/views';
  import TaskRow from './TaskRow.svelte';
  import { closeOnOutsideOrEscape } from './dismiss';

  let editingTaskId = $state<string | null>(null);

  $effect(() => closeOnOutsideOrEscape(() => editingTaskId !== null, () => (editingTaskId = null)));

  const started = $derived(openTasks(withoutLocked(app.state.tasks, app.state.lists, lock.unlocked)).filter((t) => t.inProgress));
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>In Progress</h1>
  </header>

  <section class="groups">
    {#each started as task (task.id)}
      <TaskRow {task} showList expanded={editingTaskId === task.id}
        ontoggle={() => {
          editingTaskId = editingTaskId === task.id ? null : task.id;
          if (editingTaskId) void app.markReviewed(task.id);
        }} />
    {/each}
    {#if started.length === 0}
      <p class="empty">// nothing in flight — hit the big button</p>
    {/if}
  </section>
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .groups { display: flex; flex-direction: column; gap: 6px; }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; }
</style>
