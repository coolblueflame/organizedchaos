<!--
  The persistent "what am I doing right now" card (spec §4/§6). Survives app
  kills because CurrentTaskRef lives in the kv store. Self-heals if the
  referenced task vanished (deleted / completed elsewhere / restored backup).
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { motionOk } from './fx/particles';
  import { celebrateCompletion } from './fx/celebrate';
  import { haptic } from './fx/haptics';
  import Timebox from './Timebox.svelte';
  import { completionCounts, elapsedSoFar, formatElapsed } from '../domain/stats';
  import Glyph from './Glyph.svelte';

  /** Completing THE current task is the app's biggest moment — confetti-grade. */
  function completeCurrent(e: MouseEvent, taskId: string) {
    try {
      const r = (e.currentTarget as Element).getBoundingClientRect();
      const done = completionCounts(app.state.tasks, new Date(), app.state.settings.rolloverHour);
      celebrateCompletion(r.left + r.width / 2, r.top + r.height / 2, {
        completionsToday: done.today + 1,
        emphatic: true, // finishing THE current task is the app's biggest moment
      });
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

  /**
   * The elapsed readout has to be driven by a clock, not by the task: nothing
   * about the task changes while it runs, so Svelte had no reason to re-render
   * and the card sat on whatever it said at mount ("1s in", forever). Ticks
   * only while a stretch is actually running — a paused task's total is fixed.
   */
  let now = $state(Date.now());
  $effect(() => {
    if (!task?.startedAt) return;
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });

  /** Idle-state verbs for the greyed-out no-current-task card (2026-07-26 request). */
  const CHILL = ['chillin’', 'vibing', 'relaxing', 'waiting…', 'idle', 'off the clock',
    'recharging', 'daydreaming', 'coasting', 'on standby', 'lounging', 'zen mode'];
  const chillWord = CHILL[Math.floor(Math.random() * CHILL.length)]!;
</script>

{#if task}
  {#key task.id}
  <section class="card sheen-once" data-testid="current-task-card">
    <div class="head">
      <span class="eyebrow"><Glyph name="play" size={9} /> current task</span>
      <button class="clear" data-testid="current-clear" onclick={() => void app.clearCurrent()}
        aria-label="clear current task">✕</button>
    </div>
    <button class="body" onclick={() => navigate({ name: 'list', id: task!.listId })}>
      <span class="name">{task.name || 'untitled'}</span>
      {#if listTitle}<span class="list">in {listTitle}</span>{/if}
    </button>
    <div class="timebox-row">
      <Timebox {task} />
      {#if task.startedAt || task.activeAccumulatedMs}
        <span class="elapsed" title="time actually spent working on this">
          ⧗ {formatElapsed(elapsedSoFar(task, now))} in
        </span>
      {/if}
    </div>

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
  .eyebrow { display: inline-flex; align-items: center; gap: 5px; }

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
  @media (hover: hover) { .clear:hover { color: var(--text); } }
  .body {
    display: block; width: 100%; background: none; border: none; text-align: left;
    color: var(--text); cursor: pointer; padding: 6px 0 10px;
  }
  .name { display: block; font-size: 1.1rem; font-weight: 600; }
  .list { color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }
  .timebox-row { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  .elapsed { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; }
  .actions { display: flex; gap: 8px; }
  .done {
    flex: 2; background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 8px;
    color: var(--acc-green); font-family: var(--font-mono); font-weight: 700;
    padding: 9px; cursor: pointer;
  }
  @media (hover: hover) { .done:hover { background: var(--acc-green); color: var(--bg0); } }
  .later {
    flex: 1; background: none; border: 1px solid var(--line); border-radius: 8px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; padding: 9px; cursor: pointer;
  }
  @media (hover: hover) { .later:hover { color: var(--text); } }
  .card.idle {
    border-color: var(--line); opacity: 0.55;
    display: flex; align-items: baseline; gap: 10px; padding: 10px 14px;
  }
  .eyebrow.dim { color: var(--dim); }
  .idle-hint { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; }
</style>
