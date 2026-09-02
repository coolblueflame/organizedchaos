<!--
  Stats screen (spec §6): completions over time (granularity toggle), estimated
  time-to-completion tile with the 1h-assumption note, backlog burden line.
-->
<script lang="ts">
  import { UNLOCKS } from '../eggs/content/extras';
  import Glyph from './Glyph.svelte';
  import FlameGlyph from './FlameGlyph.svelte';
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { listHealth, shortAge } from '../domain/listHealth';
  import {
    averageActiveMs, BURDEN_WINDOWS, burdenChange, burdenSeries, burdenShift, burdenTasks,
    completionSeries, formatDuration, formatDurationLong, formatElapsed,
    totalEstimateHours, type BurdenShiftEntry, type BurdenWindow,
  } from '../domain/stats';
  import { formatEstimate } from '../domain/estimate';
  import { lockedListIds } from '../domain/lock';
  import { lockSession } from '../state/lockSession.svelte';
  import { clock } from './clock.svelte';
  import { appDayKey, daysUntilDeadline } from '../domain/time';
  import { estimateQueue } from '../domain/sweep';
  import BarChart from './charts/BarChart.svelte';
  import LineChart from './charts/LineChart.svelte';

  let granularity = $state<'day' | 'week' | 'month'>('day');
  let burdenWindow = $state<BurdenWindow>('day');
  let showAssumption = $state(false);

  const BUCKETS = { day: 30, week: 12, month: 12 } as const;

  /*
    THE stats-screen performance rule: every task in `app.state.tasks` is a
    deep reactive proxy, and the burden series alone reads ~9 million fields
    (365 samples × a 25k library). Through proxy traps that is SECONDS on a
    phone; on plain objects it is tens of milliseconds. Snapshot once, compute
    on raw data — the derived caches it until the tasks actually change.
  */
  const plainTasks = $derived($state.snapshot(app.state.tasks) as typeof app.state.tasks);
  const plainLedger = $derived($state.snapshot(app.burdenLedger));

  const series = $derived(completionSeries(
    plainTasks, granularity, BUCKETS[granularity], new Date(), app.state.settings.rolloverHour));

  const plainLists = $derived($state.snapshot(app.state.lists));

  /* Archived lists are abandoned, not owed (2026-08-12 ask) — every burden
     number below counts these rows; completions history keeps ALL tasks. */
  const countedTasks = $derived(burdenTasks(plainTasks, plainLists));

  /*
    Tombstones live only on disk — the mirror keeps living rows — so this
    screen fetches them once per visit: a deletion must show up as "lighter"
    (and be NAMED in the breakdown), and a deletion's whole point is that it
    left the mirror. They join every backlog computation below, where the
    open-pile filters ignore them for "now" and the reconstruction counts
    them for "then"; the hero total never sees them.
  */
  let ghosts = $state<import('../domain/types').Task[]>([]);
  $effect(() => {
    void app.deletedTasks().then((rows) => (ghosts = rows));
  });
  const reckonTasks = $derived(
    [...countedTasks, ...burdenTasks($state.snapshot(ghosts), plainLists)]);

  const estimateHours = $derived(totalEstimateHours(countedTasks));
  const openCount = $derived(
    countedTasks.filter((t) => !t.deleted && t.completedAt === undefined).length,
  );
  const avgActive = $derived(averageActiveMs(plainTasks));
  const burdenDelta = $derived(
    burdenChange(reckonTasks, burdenWindow, clock.now, app.state.settings.rolloverHour, plainLedger));

  /** The delta, itemized on demand (2026-08-11 ask) — computed only while open. */
  let shiftOpen = $state(false);
  const shift = $derived(shiftOpen
    ? burdenShift(reckonTasks, burdenWindow, clock.now, app.state.settings.rolloverHour)
    : null);
  /**
   * What the headline moved that no row can own: estimate edits, lists
   * archived or revived, tombstones already compacted. Only a measured
   * baseline can see these (the reconstruction reprices both ends alike),
   * so the line appears once the ledger covers the comparison day.
   */
  const shiftAdjustments = $derived.by(() => {
    if (!shift) return 0;
    const scanned =
      sectionHours(shift.addedByHand) + sectionHours(shift.addedByRules)
      - sectionHours(shift.completed) - sectionHours(shift.removed);
    return burdenDelta - scanned;
  });
  /** Locked lists show hours, never names — stats' standing rule. */
  const lockedLists = $derived(lockedListIds(app.state.lists, lockSession.unlocked));
  const entryName = (e: BurdenShiftEntry) =>
    lockedLists.has(e.listId) ? 'a locked task' : (e.name || 'unnamed task');
  const sectionHours = (rows: BurdenShiftEntry[]) => rows.reduce((s, r) => s + r.hours, 0);
  /** Long sections show their heaviest movers; the subtotal owns the truth. */
  const SHIFT_ROW_CAP = 8;

  const unconfirmedEstimates = $derived(estimateQueue(plainTasks, app.state.lists).length);

  const health = $derived(listHealth(app.state.lists, plainTasks, new Date()));
  const totalUntriaged = $derived(health.reduce((n, r) => n + r.untriaged, 0));

  const burden = $derived.by(() => {
    const tasks = reckonTasks;
    const oldest = Math.min(Date.now(), ...tasks.map((t) => t.createdAt || Date.now()));
    const spanDays = Math.max(14, Math.min(365,
      -daysUntilDeadline(appDayKey(new Date(oldest), app.state.settings.rolloverHour), new Date(), app.state.settings.rolloverHour) + 1));
    return burdenSeries(tasks, spanDays, new Date(), app.state.settings.rolloverHour, plainLedger);
  });
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>Stats</h1>
  </header>

  <button class="week-link" data-testid="stats-week-link" onclick={() => navigate({ name: 'week' })}>
    ▸ this week in review
  </button>

  <button class="week-link wrapped" data-testid="stats-wrapped-link" onclick={() => navigate({ name: 'wrapped' })}>
    ▸ wrapped — the whole year
  </button>

  <section class="panel hero" data-testid="stats-estimate">
    <span class="hero-label">estimated time to finish everything
      <button class="info" aria-label="how is this computed?"
        onclick={() => (showAssumption = !showAssumption)}>ⓘ</button>
    </span>
    <!-- Every unit spelled out so the number moves with each completion;
         nobody remembers yesterday's four-digit hour count (2026-07-30 ask). -->
    <span class="hero-num">{formatDurationLong(estimateHours)}</span>
    <span class="hero-exact" data-testid="stats-open-count">across {openCount.toLocaleString()} open todo{openCount === 1 ? '' : 's'}</span>
    <!-- Which way the pile is moving, which the total alone never says
         (2026-08-03 ask). Shrinking is the good direction, so it gets the
         green and the plain word rather than a minus sign to decode. -->
    <span class="delta-row" data-testid="stats-burden-delta">
      <!-- Tappable even at "no change" — a flat delta can hide real churn
           (3h added, 3h finished), and the breakdown is where that shows. -->
      <button class="delta" class:down={burdenDelta < 0} class:up={burdenDelta > 0}
        data-testid="stats-burden-open" aria-expanded={shiftOpen}
        onclick={() => (shiftOpen = !shiftOpen)}>
        <!-- Minute-accurate, like the breakdown beneath it: rounding to the
             nearest hour hid up to 29 minutes of real movement behind "no
             change", and a small win is still a win (2026-09-02 ask). -->
        {#if Math.round(burdenDelta * 60) === 0}
          no change
        {:else if burdenDelta < 0}
          ▼ {formatDurationLong(-burdenDelta)} lighter
        {:else}
          ▲ {formatDurationLong(burdenDelta)} heavier
        {/if}
        <span class="delta-caret">{shiftOpen ? '▴' : '▾'}</span>
      </button>
      <select data-testid="stats-burden-window" bind:value={burdenWindow}
        aria-label="compare against">
        {#each Object.entries(BURDEN_WINDOWS) as [key, w] (key)}
          <option value={key}>{w.label}</option>
        {/each}
      </select>
    </span>
    {#if shift}
      <div class="shift" data-testid="burden-shift">
        {#each [
          { label: 'added', rows: shift.addedByHand, sign: '+' },
          { label: '↻ from repeating rules', rows: shift.addedByRules, sign: '+' },
          { label: 'finished', rows: shift.completed, sign: '−' },
          { label: 'removed', rows: shift.removed, sign: '−' },
        ] as section (section.label)}
          {#if section.rows.length > 0}
            <div class="shift-section">
              <div class="shift-head">
                <span>{section.label}</span>
                <span class="shift-sum" class:gain={section.sign === '+'}>
                  {section.sign}{formatEstimate(sectionHours(section.rows))}
                  · {section.rows.length}
                </span>
              </div>
              {#each section.rows.slice(0, SHIFT_ROW_CAP) as e (e.id)}
                <div class="shift-item">
                  <span class="shift-name">{entryName(e)}</span>
                  <span class="shift-hours">{formatEstimate(e.hours)}</span>
                </div>
              {/each}
              {#if section.rows.length > SHIFT_ROW_CAP}
                <div class="shift-item more">
                  + {section.rows.length - SHIFT_ROW_CAP} more ·
                  {formatEstimate(sectionHours(section.rows.slice(SHIFT_ROW_CAP)))}
                </div>
              {/if}
            </div>
          {/if}
        {/each}
        <!-- Anything the row scan cannot attribute, down to the minute: an
             estimate corrected by ten minutes is still the reason the number
             moved, and hiding it made the sections fail to add up. -->
        {#if Math.round(shiftAdjustments * 60) !== 0}
          <div class="shift-section" data-testid="shift-adjustments">
            <div class="shift-head">
              <span>estimate edits &amp; other adjustments</span>
              <span class="shift-sum" class:gain={shiftAdjustments > 0}>
                {shiftAdjustments > 0 ? '+' : '−'}{formatEstimate(Math.abs(shiftAdjustments))}
              </span>
            </div>
          </div>
        {/if}
        {#if shift.addedByHand.length + shift.addedByRules.length + shift.completed.length + shift.removed.length === 0
          && Math.round(shiftAdjustments * 60) === 0}
          <div class="shift-item more">nothing moved in this window</div>
        {/if}
      </div>
    {/if}
    {#if unconfirmedEstimates > 0}
      <button class="est-check" data-testid="stats-est-check"
        onclick={() => navigate({ name: 'sweep', mode: 'estimates' })}>
        {unconfirmedEstimates} of these are the silent 1h assumption → confirm them
      </button>
    {/if}
    {#if showAssumption}
      <p class="assumption">Sum of your open tasks' estimates — any task without an estimate
        is assumed to take 1 hour. Archived lists don't count: shelved means not owed.</p>
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
  {#if app.eggBestStreak >= 3}
    <section class="panel streak-panel" data-testid="streak-panel">
      <span class="streak-now"><FlameGlyph size={15} /> {app.eggStreak}-day streak</span>
      <span class="streak-best">longest ever: {app.eggBestStreak} days</span>
    </section>
  {/if}

  <section class="panel">
    <div class="panel-head"><h2>list health (where to point the sweep)</h2></div>
    <table class="health" data-testid="list-health">
      <thead><tr><th>list</th><th>open</th><th>untriaged</th><th>median age</th></tr></thead>
      <tbody>
        {#each health as row (row.list.id)}
          <tr class:done={row.untriaged === 0 && row.open === 0}>
            <td class="h-title">
              <button class="h-link" onclick={() => navigate({ name: 'list', id: row.list.id })}>
                {row.list.title}
              </button>
            </td>
            <td>{row.open}</td>
            <td class:warn={row.untriaged > 0}>{row.untriaged || '—'}</td>
            <td>{row.open ? shortAge(row.medianAgeDays) : '—'}</td>
          </tr>
        {/each}
      </tbody>
    </table>
    {#if totalUntriaged > 0}
      <button class="h-sweep" data-testid="health-sweep" onclick={() => navigate({ name: 'sweep' })}>
        ✎ sweep the {totalUntriaged} untriaged →
      </button>
    {:else}
      <p class="footnote">every task has been looked at — the sweep is caught up</p>
    {/if}
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
  /* One line, always: the long form can reach "2mo 1w 3d 5h" and wrapping it
     mid-figure made the headline number hard to read (2026-08-03 ask).
     clamp() shrinks it on narrow screens instead of breaking it. */
  .hero-num {
    color: var(--acc-purple); font-family: var(--font-mono); font-weight: 700;
    font-size: clamp(1.15rem, 7vw, 2rem);
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  }
  .delta-row { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; margin-top: 2px; }
  .delta {
    font-family: var(--font-mono); font-size: 0.78rem; color: var(--dim);
    background: none; border: none; padding: 0; cursor: pointer;
  }
  .delta.down { color: var(--acc-green); }
  .delta.up { color: var(--acc-orange); }
  .delta-caret { opacity: 0.6; margin-left: 2px; }
  .shift {
    display: flex; flex-direction: column; gap: 10px;
    border: 1px solid var(--line); border-radius: 8px;
    padding: 10px 12px; margin-top: 8px; text-align: left;
  }
  .shift-section { display: flex; flex-direction: column; gap: 3px; }
  .shift-head {
    display: flex; justify-content: space-between; gap: 8px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem;
    text-transform: uppercase; letter-spacing: 0.06em;
  }
  .shift-sum { color: var(--acc-green); text-transform: none; }
  .shift-sum.gain { color: var(--acc-orange); }
  .shift-item {
    display: flex; justify-content: space-between; gap: 10px;
    font-size: 0.78rem; color: var(--text);
  }
  .shift-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .shift-hours { color: var(--dim); font-family: var(--font-mono); flex: none; }
  .shift-item.more { color: var(--dim); font-size: 0.72rem; }
  .delta-row select {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    padding: 2px 6px; max-width: 55vw;
  }
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
  .health { width: 100%; border-collapse: collapse; font-size: 0.78rem; }
  .health th {
    text-align: left; color: var(--dim); font-family: var(--font-mono); font-size: 0.65rem;
    text-transform: uppercase; letter-spacing: 0.06em; padding: 4px 8px 6px 0; font-weight: 600;
  }
  .health td { padding: 5px 8px 5px 0; border-top: 1px solid var(--line); font-family: var(--font-mono); color: var(--dim); }
  .health td.warn { color: var(--acc-yellow); }
  .health tr.done td { opacity: 0.5; }
  .h-title { max-width: 0; width: 55%; }
  .h-link {
    background: none; border: none; padding: 0; cursor: pointer; text-align: left;
    color: var(--text); font: inherit; max-width: 100%;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: block;
  }
  @media (hover: hover) { .h-link:hover { color: var(--acc-cyan); } }
  .h-sweep {
    margin-top: 10px; background: none; border: 1px dashed var(--acc-yellow); border-radius: 8px;
    color: var(--acc-yellow); font-family: var(--font-mono); font-size: 0.75rem;
    padding: 8px 12px; cursor: pointer;
  }
  @media (hover: hover) { .h-sweep:hover { border-style: solid; } }
  .streak-panel { flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; }
  .streak-now {
    display: inline-flex; align-items: center; gap: 8px;
    color: var(--acc-cyan); font-family: var(--font-mono); font-weight: 700; font-size: 0.95rem;
  }
  .streak-best { color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }
  summary { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; cursor: pointer; }
  table { width: 100%; margin-top: 6px; border-collapse: collapse; font-size: 0.75rem; }
  th, td { text-align: left; padding: 3px 6px; border-bottom: 1px solid var(--line); color: var(--text); }
  th { color: var(--dim); font-family: var(--font-mono); }
  .hero-exact { color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.72rem; }
  .week-link {
    display: block; width: 100%; text-align: left; margin-bottom: 12px;
    background: var(--bg1); border: 1px solid color-mix(in srgb, var(--acc-green) 30%, var(--line));
    border-radius: 12px; padding: 12px 16px; cursor: pointer;
    color: var(--acc-green); font-family: var(--font-mono); font-size: 0.85rem;
  }
  @media (hover: hover) { .week-link:hover { background: var(--bg2); } }
  .week-link.wrapped { color: var(--acc-purple); border-color: color-mix(in srgb, var(--acc-purple) 30%, var(--line)); }
  .est-check {
    background: none; border: none; color: var(--acc-yellow); cursor: pointer;
    font-family: var(--font-mono); font-size: 0.7rem; padding: 2px 0; text-align: left;
    text-decoration: underline; text-underline-offset: 3px;
  }
  @media (hover: hover) { .est-check:hover { color: var(--text); } }
</style>
