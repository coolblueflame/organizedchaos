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

<button class="strip" data-testid="stats-strip" onclick={() => navigate({ name: 'stats' })}>
  {#each tiles as t, i (t.label)}
    <span class="tile">
      <span class="num">{shown[i]}</span>
      <span class="label">{t.label}</span>
    </span>
  {/each}
  {#if app.eggStreak >= 3}
    <span class="flame" title="{app.eggStreak}-day streak"><Glyph name="flame" size={11} /><span class="flame-n">{app.eggStreak}</span></span>
  {/if}
</button>

<style>
  .flame { display: inline-flex; align-items: center; gap: 2px; }

  .strip {
    width: 100%; display: flex; justify-content: space-between; gap: 4px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px; margin-bottom: 14px; cursor: pointer;
  }
  .strip:hover { background: var(--bg2); }
  .tile { display: flex; flex-direction: column; align-items: center; gap: 2px; flex: 1; }
  .num { color: var(--acc-green); font-family: var(--font-mono); font-size: 1.05rem; font-weight: 700; }
  .label { color: var(--dim); font-family: var(--font-mono); font-size: 0.6rem; text-transform: uppercase; letter-spacing: 0.06em; }
  .flame { display: flex; flex-direction: column; align-items: center; font-size: 0.95rem; }
  .flame-n { color: var(--acc-orange); font-family: var(--font-mono); font-size: 0.65rem; font-weight: 700; }
</style>
