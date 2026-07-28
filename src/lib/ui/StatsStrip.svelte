<!-- Home stats strip (spec §6): five completion counters, count-up on mount. -->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { completionCounts } from '../domain/stats';
  import { motionOk } from './fx/particles';
  import Glyph from './Glyph.svelte';

  const counts = $derived(completionCounts(app.state.tasks, new Date(), app.state.settings.rolloverHour));

  const tiles = $derived([
    { label: 'today', value: counts.today },
    { label: 'week', value: counts.week },
    { label: 'month', value: counts.month },
    { label: 'year', value: counts.year },
    { label: 'all time', value: counts.lifetime },
  ] as const);

  /** Count-up: shown values chase the real ones over ~600ms on mount. */
  let shown = $state<number[]>([0, 0, 0, 0, 0]);
  let animated = false;
  $effect(() => {
    const targets = tiles.map((t) => t.value);
    if (animated || !motionOk()) {
      shown = targets;
      animated = true;
      return;
    }
    animated = true;
    const t0 = performance.now();
    const tick = (ts: number) => {
      const f = Math.min(1, (ts - t0) / 600);
      const ease = 1 - Math.pow(1 - f, 3);
      shown = targets.map((v) => Math.round(v * ease));
      if (f < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
</script>

<!-- The streak lives in its OWN square (2026-07-28 request): squeezed inside
     the strip it had nowhere to grow past one digit, and a streak deserves to
     read as a thing you keep, not a sixth counter. -->
<div class="row">
  <button class="strip" data-testid="stats-strip" onclick={() => navigate({ name: 'stats' })}>
    {#each tiles as t, i (t.label)}
      <span class="tile">
        <span class="num">{shown[i]}</span>
        <span class="label">{t.label}</span>
      </span>
    {/each}
  </button>
  {#if app.eggStreak >= 3}
    <button class="streak" data-testid="streak-tile" onclick={() => navigate({ name: 'stats' })}
      title="{app.eggStreak}-day streak · best {app.eggBestStreak}">
      <Glyph name="flame" size={15} />
      <span class="streak-n">{app.eggStreak}</span>
      <span class="label">streak</span>
    </button>
  {/if}
</div>

<style>

  .row { display: flex; gap: 8px; margin-bottom: 14px; }
  .strip {
    flex: 1; min-width: 0; display: flex; justify-content: space-between; gap: 4px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px; cursor: pointer;
  }
  .strip:hover { background: var(--bg2); }
  .tile { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1; }
  .num { color: var(--acc-green); font-family: var(--font-mono); font-size: 1.05rem; font-weight: 700; }
  .label { color: var(--dim); font-family: var(--font-mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; }
  .streak {
    flex: none; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 1px; min-width: 52px; padding: 6px 10px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px;
    color: var(--acc-cyan); cursor: pointer;
  }
  .streak:hover { background: var(--bg2); }
  .streak-n { color: var(--acc-orange); font-family: var(--font-mono); font-size: 1.05rem; font-weight: 700; }
</style>
