<!--
  Work period: "I have 20 minutes." While one is running the randomizer only
  offers tasks that actually fit the time left — except MAX-priority work,
  which always gets through.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { eligibleForDraw } from '../domain/randomizer';
  import { effectivePriority } from '../domain/priority';

  const PRESETS = [20, 45, 90];

  let picking = $state(false);
  let custom = $state('25');
  let now = $state(Date.now());

  const endsAt = $derived(app.workPeriodEndsAt);
  const msLeft = $derived(endsAt ? endsAt - now : 0);
  const running = $derived(endsAt !== null && msLeft > 0);

  $effect(() => {
    if (!endsAt) return;
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });

  // Auto-retire the period the moment it lapses.
  $effect(() => {
    if (endsAt && msLeft <= 0) void app.endWorkPeriod();
  });

  /** How many tasks could actually be drawn right now. */
  const fitting = $derived.by(() => {
    if (!running) return 0;
    const hours = msLeft / 3_600_000;
    return eligibleForDraw(app.state.tasks, new Date()).filter(
      (t) =>
        effectivePriority(t, app.state.settings, new Date()) === 'max' ||
        (t.estimateHours ?? 1) <= hours,
    ).length;
  });

  function clock(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  async function start(minutes: number) {
    picking = false;
    if (minutes > 0) {
      await app.startWorkPeriod(minutes);
      app.fireEgg('workPeriodStarted');
    }
  }
</script>

{#if running}
  <div class="running" data-testid="work-period-running">
    <span class="clock">{clock(msLeft)}</span>
    <span class="meta">work period · {fitting} task{fitting === 1 ? '' : 's'} fit</span>
    <button data-testid="work-period-end" onclick={() => void app.endWorkPeriod()}>end</button>
  </div>
{:else if picking}
  <div class="picker" data-testid="work-period-picker">
    <span class="label">I have…</span>
    {#each PRESETS as m (m)}
      <button data-testid="work-period-{m}" onclick={() => void start(m)}>{m}m</button>
    {/each}
    <input type="number" min="1" max="600" data-testid="work-period-custom" bind:value={custom} />
    <button data-testid="work-period-custom-go" onclick={() => void start(parseInt(custom, 10) || 0)}>go</button>
    <button class="cancel" onclick={() => (picking = false)}>✕</button>
  </div>
{:else}
  <button class="open" data-testid="work-period-open" onclick={() => (picking = true)}>
    ⏱ start a work period
  </button>
{/if}

<style>
  .open {
    width: 100%; background: none; border: 1px dashed var(--line); border-radius: 8px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem;
    padding: 8px; cursor: pointer; margin-bottom: 10px;
  }
  .open:hover { color: var(--acc-cyan); border-color: var(--acc-cyan); }
  .picker {
    display: flex; flex-wrap: wrap; gap: 6px; align-items: center; margin-bottom: 10px;
    background: var(--bg1); border: 1px solid var(--acc-cyan); border-radius: 8px; padding: 8px;
  }
  .label { color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem; }
  .picker button, .running button {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 5px 10px; cursor: pointer;
  }
  .picker input {
    width: 56px; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.72rem; padding: 4px 6px;
  }
  .picker .cancel { color: var(--dim); border-color: transparent; }
  .running {
    display: flex; align-items: center; gap: 10px; margin-bottom: 10px;
    background: var(--bg1); border: 1px solid var(--acc-cyan); border-radius: 8px; padding: 8px 12px;
  }
  .clock { color: var(--acc-cyan); font-family: var(--font-mono); font-size: 1rem; font-weight: 700; }
  .meta { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; flex: 1; }
</style>
