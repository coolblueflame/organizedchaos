<!--
  The persistent "what am I doing right now" card (spec §4/§6). Survives app
  kills because CurrentTaskRef lives in the kv store. Self-heals if the
  referenced task vanished (deleted / completed elsewhere / restored backup).
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { confettiAt, motionOk } from './fx/particles';
  import { haptic } from './fx/haptics';

  /** Completing THE current task is the app's biggest moment — confetti-grade. */
  function completeCurrent(e: MouseEvent, taskId: string) {
    try {
      const r = (e.currentTarget as Element).getBoundingClientRect();
      confettiAt(r.left + r.width / 2, r.top + r.height / 2);
      haptic('heavy');
    } catch { /* fx must never block completion */ }
    setTimeout(() => void app.completeTask(taskId), motionOk() ? 320 : 0);
  }

  const task = $derived.by(() => {
    const ref = app.state.currentTask;
    if (!ref) return null;
    const t = app.state.tasks.find((x) => x.id === ref.taskId);
    return t && !t.deleted && t.completedAt === undefined ? t : null;
  });

  // Self-heal: a dangling ref (task deleted/completed out from under us) gets cleared.
  $effect(() => {
    if (app.state.currentTask && !task) void app.clearCurrent();
  });

  const listTitle = $derived(task ? app.state.lists.find((l) => l.id === task!.listId)?.title : undefined);

  /** Idle-state verbs for the greyed-out no-current-task card (2026-07-26 request). */
  const CHILL = ['chillin’', 'vibing', 'relaxing', 'waiting…', 'idle', 'off the clock',
    'recharging', 'daydreaming', 'coasting', 'on standby', 'lounging', 'zen mode'];
  const chillWord = CHILL[Math.floor(Math.random() * CHILL.length)]!;
</script>

{#if task}
  {#key task.id}
  <section class="card sheen-once" data-testid="current-task-card">
    <div class="head">
      <span class="eyebrow">▶ current task</span>
      <button class="clear" data-testid="current-clear" onclick={() => void app.clearCurrent()}
        aria-label="clear current task">✕</button>
    </div>
    <button class="body" onclick={() => navigate({ name: 'list', id: task!.listId })}>
      <span class="name">{task.name || 'untitled'}</span>
      {#if listTitle}<span class="list">in {listTitle}</span>{/if}
    </button>
    <div class="actions">
      <button class="done" data-testid="current-complete" onclick={(e) => completeCurrent(e, task!.id)}>
        ✓ done
      </button>
      <button class="later" data-testid="current-not-today" onclick={() => void app.sendNotToday(task!.id)}>
        not today
      </button>
    </div>
  </section>
  {/key}
{:else}
  <section class="card idle" data-testid="current-task-idle">
    <span class="eyebrow dim">▸ {chillWord}</span>
    <span class="idle-hint">the big button knows what you should do</span>
  </section>
{/if}

<style>
  .card {
    background: var(--bg1); border: 1px solid var(--acc-cyan); border-radius: 12px;
    padding: 14px; margin-bottom: 16px;
  }
  .head { display: flex; justify-content: space-between; align-items: center; }
  .eyebrow {
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.1em;
  }
  .clear { background: none; border: none; color: var(--dim); cursor: pointer; font-size: 0.8rem; padding: 2px 6px; }
  .clear:hover { color: var(--text); }
  .body {
    display: block; width: 100%; background: none; border: none; text-align: left;
    color: var(--text); cursor: pointer; padding: 6px 0 10px;
  }
  .name { display: block; font-size: 1.1rem; font-weight: 600; }
  .list { color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }
  .actions { display: flex; gap: 8px; }
  .done {
    flex: 2; background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 8px;
    color: var(--acc-green); font-family: var(--font-mono); font-weight: 700;
    padding: 9px; cursor: pointer;
  }
  .done:hover { background: var(--acc-green); color: var(--bg0); }
  .later {
    flex: 1; background: none; border: 1px solid var(--line); border-radius: 8px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; padding: 9px; cursor: pointer;
  }
  .later:hover { color: var(--text); }
  .card.idle {
    border-color: var(--line); opacity: 0.55;
    display: flex; align-items: baseline; gap: 10px; padding: 10px 14px;
  }
  .eyebrow.dim { color: var(--dim); }
  .idle-hint { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; }
</style>
