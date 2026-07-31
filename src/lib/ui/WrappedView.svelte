<!--
  Wrapped (#/wrapped): the year in superlatives. Sealed until December 1st —
  before that the screen is a teaser with a countdown, because anticipation
  is most of a Wrapped's charm. Numbers only ever celebrate; an empty year
  is "still writing itself", never a scolding.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { clock } from './clock.svelte';
  import { daysUntilWrapped, wrappedIsOpen, yearWrapped } from '../domain/wrapped';
  import { formatElapsed } from '../domain/stats';
  import { UNLOCKS } from '../eggs/content/extras';
  import Glyph from './Glyph.svelte';
  import FlameGlyph from './FlameGlyph.svelte';

  // Same proxy-escape as StatsView: the scan reads every task.
  const plainTasks = $derived($state.snapshot(app.state.tasks) as typeof app.state.tasks);
  const open = $derived(wrappedIsOpen(clock.now, app.state.settings.rolloverHour));
  const countdown = $derived(daysUntilWrapped(clock.now, app.state.settings.rolloverHour));
  const r = $derived(yearWrapped(
    plainTasks, app.state.lists, clock.now, app.state.settings.rolloverHour));

  const MONTHS = ['J', 'F', 'M', 'A', 'M', 'J', 'J', 'A', 'S', 'O', 'N', 'D'];
  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December'];
  const maxMonth = $derived(Math.max(1, ...r.byMonth));

  const discoveries = $derived(app.eggUnlocks.length);

  const dayName = (key: string) =>
    new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'stats' })}>‹</button>
    <h1>Wrapped {r.year}</h1>
  </header>

  {#if !open}
    <!-- The seal. The one number it shows is the year-so-far count: enough
         of a taste to make December 1st a date worth circling. -->
    <section class="panel hero" data-testid="wrapped-teaser">
      <span class="hero-num">{r.completions}</span>
      <span class="hero-label">done in {r.year} — so far</span>
      <p class="tease">the year is still writing itself.
        the full story unwraps in <strong>{countdown} day{countdown === 1 ? '' : 's'}</strong>
        — December 1st. 🎁</p>
    </section>
  {:else}
    <section class="panel hero" data-testid="wrapped-hero">
      <span class="hero-num">{r.completions}</span>
      <span class="hero-label">things finished in {r.year}</span>
      {#if r.activeDays > 0}
        <span class="sub">across {r.activeDays} active day{r.activeDays === 1 ? '' : 's'}
          {#if r.created > 0}&nbsp;· {r.created} new ones written down{/if}</span>
      {/if}
    </section>

    <section class="panel" data-testid="wrapped-months">
      <div class="bars">
        {#each r.byMonth as count, i (i)}
          <div class="month">
            <div class="bar" style="height: {Math.round((count / maxMonth) * 44)}px"></div>
            <span class="label">{MONTHS[i]}</span>
          </div>
        {/each}
      </div>
      {#if r.busiestMonth && r.busiestMonth.count > 0}
        <p class="note">{MONTH_NAMES[r.busiestMonth.month]} was the big one — {r.busiestMonth.count} finished.</p>
      {/if}
      {#if r.busiestDay && r.busiestDay.count > 1}
        <p class="note">single best day: {dayName(r.busiestDay.key)}, {r.busiestDay.count} in a day.</p>
      {/if}
    </section>

    {#if r.topLists.length > 0}
      <section class="panel" data-testid="wrapped-lists">
        <h2>where the year happened</h2>
        <ol>
          {#each r.topLists as l, i (l.title + i)}
            <li><span class="rank">{i + 1}</span> {l.title} <span class="dim">— {l.count}</span></li>
          {/each}
        </ol>
      </section>
    {/if}

    {#if r.longestHaul && r.longestHaul.waitDays > 30}
      <section class="panel" data-testid="wrapped-haul">
        <h2>the long game</h2>
        <p class="haul">“{r.longestHaul.task.name || 'untitled'}” waited
          <strong>{r.longestHaul.waitDays} days</strong> — and you still got it. 🏆</p>
      </section>
    {/if}

    <section class="panel" data-testid="wrapped-extras">
      {#if r.trackedMs > 0}
        <span class="line">⧗ {formatElapsed(r.trackedMs)} of tracked focus</span>
      {/if}
      {#if app.eggBestStreak >= 3}
        <span class="line"><FlameGlyph size={13} /> longest streak: {app.eggBestStreak} days</span>
      {/if}
      {#if discoveries > 0}
        <span class="line"><Glyph name="award" size={12} /> {discoveries} of {UNLOCKS.length} discoveries found</span>
      {/if}
      {#if app.eggTrivia.total > 0}
        <span class="line">? trivia record: {app.eggTrivia.correct}/{app.eggTrivia.total}</span>
      {/if}
    </section>

    {#if r.topWins.length > 0}
      <section class="panel" data-testid="wrapped-wins">
        <h2>the headliners</h2>
        <ul>
          {#each r.topWins as t (t.id)}
            <li><Glyph name="check" size={11} /> {t.name || 'untitled'}</li>
          {/each}
        </ul>
      </section>
    {:else}
      <p class="empty">// a quiet year so far — the dice are patient</p>
    {/if}
  {/if}
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }

  .panel {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 12px;
    padding: 14px 16px; margin-bottom: 12px;
    display: flex; flex-direction: column; gap: 6px;
  }
  .hero .hero-num { font-family: var(--font-mono); font-size: 2.4rem; font-weight: 700; color: var(--acc-purple); }
  .hero-label { color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem; }
  .sub { color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem; }
  .tease { margin: 6px 0 0; color: var(--text); font-family: var(--font-mono); font-size: 0.82rem; line-height: 1.5; }
  .tease strong { color: var(--acc-green); }

  .bars { display: flex; align-items: flex-end; gap: 4px; justify-content: space-between; }
  .month { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .bar { width: 100%; max-width: 22px; background: var(--acc-purple); opacity: 0.65; border-radius: 3px 3px 0 0; min-height: 2px; }
  .label { color: var(--dim); font-family: var(--font-mono); font-size: 0.6rem; }
  .note { margin: 4px 0 0; color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.72rem; }

  h2 { font-family: var(--font-mono); font-size: 0.8rem; color: var(--dim); margin: 0; text-transform: uppercase; letter-spacing: 0.08em; }
  ol, ul { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; align-items: baseline; gap: 8px; font-size: 0.88rem; }
  li :global(svg) { color: var(--acc-green); flex: none; transform: translateY(1px); }
  .rank { color: var(--acc-purple); font-family: var(--font-mono); font-weight: 700; }
  .dim { color: var(--dim); }
  .haul { margin: 0; font-size: 0.88rem; line-height: 1.5; }
  .haul strong { color: var(--acc-orange); }
  .line { font-family: var(--font-mono); font-size: 0.85rem; color: var(--text); display: flex; align-items: center; gap: 6px; }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; }
</style>
