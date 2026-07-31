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
  import { checklistProgress } from '../domain/checklist';
  import Checklist from './Checklist.svelte';
  import Glyph from './Glyph.svelte';

  /**
   * The focus loop's missing hinge (2026-07-31, shortlist item 6): finishing
   * the current task used to dead-end in the idle card, and continuing meant
   * finding the big button again. Acting on the card (done / not today) arms
   * a one-tap "roll the next one" in its place — the loop closes itself.
   * Session-local on purpose: an app open later should greet, not push.
   */
  let { onroll }: { onroll?: () => void } = $props();
  let loopArmed = $state(false);

  /** Completing THE current task is the app's biggest moment — confetti-grade. */
  function completeCurrent(e: MouseEvent, taskId: string) {
    loopArmed = true;
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

  // Accepting a fresh draw disarms the invitation — the card is working again.
  $effect(() => {
    if (task) loopArmed = false;
  });

  const doneToday = $derived(
    completionCounts(app.state.tasks, new Date(), app.state.settings.rolloverHour).today);

  const listTitle = $derived(task ? app.state.lists.find((l) => l.id === task!.listId)?.title : undefined);
  const progress = $derived(task ? checklistProgress(task.notes) : null);

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
    <!-- Straight to the task's own editor, not just its list — the details
         are what you tap a task's name for (2026-07-30 ask: checklists). -->
    <button class="body" data-testid="current-open-details"
      onclick={() => navigate({ name: 'list', id: task!.listId, taskId: task!.id })}>
      <span class="name">{task.name || 'untitled'}</span>
      {#if listTitle}<span class="list">in {listTitle}</span>{/if}
    </button>
    {#if progress}
      <!-- The working surface for a checklist-shaped task ("pack for the
           trip"): tick items right here while it is THE thing you're doing. -->
      <div class="check-wrap">
        <Checklist notes={task.notes} taskId={task.id}
          onchange={(n) => void app.patchTask(task!.id, { notes: n })} />
        <span class="check-progress" data-testid="current-check-progress">{progress.done}/{progress.total}</span>
      </div>
    {/if}
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
      <button class="later" data-testid="current-not-today"
        onclick={() => { loopArmed = true; void app.sendNotToday(task!.id); }}>
        not today
      </button>
    </div>
  </section>
  {/key}
{:else if loopArmed && onroll}
  <section class="card roll-next" data-testid="current-roll-next">
    <span class="eyebrow next">▸ next?</span>
    <span class="roll-count">
      {doneToday > 0 ? `that’s ${doneToday} today.` : 'that one’s handled.'}
    </span>
    <button class="roll" data-testid="roll-next" onclick={onroll}>
      <Glyph name="dice" size={12} /> roll the next one
    </button>
  </section>
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
  .check-wrap { position: relative; padding: 2px 0 8px; }
  .check-progress {
    position: absolute; top: 2px; right: 0;
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.7rem;
  }
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
  .card.roll-next {
    border-color: var(--acc-purple);
    display: flex; align-items: center; gap: 10px; padding: 10px 14px; flex-wrap: wrap;
  }
  .eyebrow.next { color: var(--acc-purple); }
  .roll-count { color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }
  .roll {
    margin-left: auto; background: var(--bg2); border: 1px solid var(--acc-purple);
    border-radius: 8px; color: var(--acc-purple); font-family: var(--font-mono);
    font-weight: 700; font-size: 0.8rem; padding: 8px 12px; cursor: pointer;
    display: inline-flex; align-items: center; gap: 6px;
  }
  @media (hover: hover) { .roll:hover { background: var(--acc-purple); color: var(--bg0); } }
  .card.idle {
    border-color: var(--line); opacity: 0.55;
    display: flex; align-items: baseline; gap: 10px; padding: 10px 14px;
  }
  .eyebrow.dim { color: var(--dim); }
  .idle-hint { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; }
</style>
