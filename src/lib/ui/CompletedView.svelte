<!--
  Completed history (spec §6): every finished task grouped by completion
  app-day (4am rule), newest first, with one-tap restore.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { groupCompleted } from '../domain/views';
  import { appDayKey } from '../domain/time';
  import TaskRow from './TaskRow.svelte';

  const groups = $derived(
    groupCompleted(app.state.tasks, app.state.settings.rolloverHour),
  );

  function dayLabel(key: string): string {
    const rollover = app.state.settings.rolloverHour;
    const today = appDayKey(new Date(), rollover);
    if (key === today) return 'Today';
    const y = new Date();
    y.setDate(y.getDate() - 1);
    if (key === appDayKey(y, rollover)) return 'Yesterday';
    return key;
  }
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>Completed</h1>
  </header>

  <section class="groups">
    {#each groups as group (group.key)}
      <h2 class="group-header">{dayLabel(group.key)}</h2>
      {#each group.tasks as task (task.id)}
        <TaskRow {task} completedMode showList ontoggle={() => {}} />
      {/each}
    {/each}
    {#if groups.length === 0}
      <p class="empty">// nothing completed yet — the button awaits</p>
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
