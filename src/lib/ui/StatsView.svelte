<!--
  Stats screen (spec §6): completions over time (granularity toggle), estimated
  time-to-completion tile with the 1h-assumption note, backlog burden line.
-->
<script lang="ts">
  import { UNLOCKS } from '../eggs/content/extras';
  import Glyph from './Glyph.svelte';
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import {
    averageActiveMs, burdenSeries, completionSeries, formatDuration, formatElapsed,
    totalEstimateHours,
  } from '../domain/stats';
  import { appDayKey, daysUntilDeadline } from '../domain/time';
  import BarChart from './charts/BarChart.svelte';
  import LineChart from './charts/LineChart.svelte';

  let granularity = $state<'day' | 'week' | 'month'>('day');
  let showAssumption = $state(false);

  const BUCKETS = { day: 30, week: 12, month: 12 } as const;

  const series = $derived(completionSeries(
    app.state.tasks, granularity, BUCKETS[granularity], new Date(), app.state.settings.rolloverHour));

  const estimateHours = $derived(totalEstimateHours(app.state.tasks));
  const avgActive = $derived(averageActiveMs(app.state.tasks));

  const burden = $derived.by(() => {
    const tasks = app.state.tasks;
    const oldest = Math.min(Date.now(), ...tasks.map((t) => t.createdAt || Date.now()));
    const spanDays = Math.max(14, Math.min(365,
      -daysUntilDeadline(appDayKey(new Date(oldest), app.state.settings.rolloverHour), new Date(), app.state.settings.rolloverHour) + 1));
    return burdenSeries(tasks, spanDays, new Date(), app.state.settings.rolloverHour);
  });
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>Stats</h1>
  </header>

  <section class="panel hero" data-testid="stats-estimate">
    <span class="hero-label">estimated time to finish everything
      <button class="info" aria-label="how is this computed?"
        onclick={() => (showAssumption = !showAssumption)}>ⓘ</button>
    </span>
    <span class="hero-num">{formatDuration(estimateHours)}</span>
    {#if showAssumption}
      <p class="assumption">Sum of your open tasks' estimates — any task without an estimate
        is assumed to take 1 hour.</p>
    {/if}
  </section>

  {#if avgActive !== null}
    <section class="panel hero" data-testid="stats-average-time">
      <span class="hero-label">average time to finish a task</span>
      <span class="hero-num small">{formatElapsed(avgActive)}</span>
      <p class="assumption">measured from when you accept a task to when you complete it,
        across everything you've finished here</p>
    </section>
  {/if}

  <section class="panel">
    <div class="panel-head">
      <h2>tasks completed</h2>
      <div class="seg">
        <button class:on={granularity === 'day'} data-testid="stats-gran-day" onclick={() => (granularity = 'day')}>day</button>
        <button class:on={granularity === 'week'} data-testid="stats-gran-week" onclick={() => (granularity = 'week')}>week</button>
        <button class:on={granularity === 'month'} data-testid="stats-gran-month" onclick={() => (granularity = 'month')}>month</button>
      </div>
    </div>
    <BarChart points={series} color="var(--acc-green)" />
    <details>
      <summary>as table</summary>
      <table>
        <thead><tr><th>period</th><th>completed</th></tr></thead>
        <tbody>
          {#each series as p (p.key)}<tr><td>{p.key}</td><td>{p.count}</td></tr>{/each}
        </tbody>
      </table>
    </details>
  </section>

  <section class="panel">
    <div class="panel-head"><h2>backlog burden (hours of work on your plate)</h2></div>
    <LineChart points={burden} color="var(--acc-orange)" format={formatDuration} />
    <p class="footnote">reconstructed from when tasks were created, completed, and deleted —
      the honest "am I adding more than I finish?" chart</p>
    <details>
      <summary>as table</summary>
      <table>
        <thead><tr><th>day</th><th>hours</th></tr></thead>
        <tbody>
          {#each burden.filter((_, i) => i % Math.max(1, Math.floor(burden.length / 30)) === 0) as p (p.key)}
            <tr><td>{p.key}</td><td>{p.hours}</td></tr>
          {/each}
        </tbody>
      </table>
    </details>
  </section>
  <section class="panel">
    <h2>discoveries</h2>
    <p class="discoveries-hint">Things you've stumbled into. There are more.
      {#if app.eggTrivia.total > 0}&nbsp;Quiz score: {app.eggTrivia.correct}/{app.eggTrivia.total}.{/if}
    </p>
    <ul class="discoveries" data-testid="discoveries">
      {#each UNLOCKS as u (u.id)}
        <li class:found={app.eggUnlocks.includes(u.id)}>
          {#if app.eggUnlocks.includes(u.id)}<Glyph name="award" size={11} /> {u.label}
          {:else}<Glyph name="locked" size={11} /> ??? <span class="disc-hint">({u.hint})</span>{/if}
        </li>
      {/each}
    </ul>
  </section>
</main>

<style>
  /* StatsView had no .hint of its own, so the blurb inherited the default
     paragraph size and towered over the panel it sits in. */
  .discoveries-hint { color: var(--dim); font-size: 0.8rem; margin: 0; line-height: 1.5; }
  .discoveries { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .discoveries li { display: flex; align-items: center; gap: 6px; color: var(--dim); font-size: 0.82rem; }
  /* Earned ones read as gold — the medal glyph inherits it via currentColor,
     so the whole line lifts off the dim ??? rows around it. */
  .discoveries li.found { color: var(--acc-yellow); font-weight: 600; }
  .disc-hint { opacity: 0.6; font-size: 0.72rem; font-style: italic; }

  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .panel {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px; margin-bottom: 14px;
  }
  .panel-head { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-bottom: 10px; flex-wrap: wrap; }
  h2 { color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; margin: 0; }
  .hero { display: flex; flex-direction: column; gap: 4px; }
  .hero-label { color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase; letter-spacing: 0.08em; }
  .hero-num { color: var(--acc-purple); font-family: var(--font-mono); font-size: 2rem; font-weight: 700; }
  .hero-num.small { color: var(--acc-cyan); font-size: 1.5rem; }
  .info { background: none; border: none; color: var(--acc-blue); cursor: pointer; font-size: 0.8rem; padding: 0 2px; }
  .assumption { color: var(--dim); font-size: 0.8rem; margin: 4px 0 0; }
  .seg { display: flex; border: 1px solid var(--line); border-radius: 6px; overflow: hidden; }
  .seg button {
    background: none; border: none; color: var(--dim); font-family: var(--font-mono);
    font-size: 0.7rem; padding: 5px 10px; cursor: pointer;
  }
  .seg button.on { background: var(--bg2); color: var(--acc-green); }
  .footnote { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; margin: 8px 0 0; }
  details { margin-top: 8px; }
  summary { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; cursor: pointer; }
  table { width: 100%; margin-top: 6px; border-collapse: collapse; font-size: 0.75rem; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--line); color: var(--text); }
  th { color: var(--dim); font-family: var(--font-mono); }
</style>
