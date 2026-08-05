<!--
  The week in review (#/week): what this app-week looked like — counts vs last
  week, the day-by-day shape, tracked time, the estimate scoreboard, and the
  headline wins. A celebration surface, not a guilt surface: an empty week
  just says the week is young.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { clock } from './clock.svelte';
  import { withoutLocked } from '../domain/lock';
  import { lock } from './lock.svelte';
  import { weekReview, weekWinsList } from '../domain/weekReview';
  import { formatElapsed } from '../domain/stats';
  import Glyph from './Glyph.svelte';

  // Same proxy-escape as StatsView: the scan reads every task.
  // Locked lists' tasks stay out of the wins and totals while locked — a
  // celebration screen reading their names out loud would defeat the PIN.
  const plainTasks = $derived(withoutLocked(
    $state.snapshot(app.state.tasks) as typeof app.state.tasks,
    app.state.lists, lock.unlocked));
  const review = $derived(weekReview(plainTasks, clock.now, app.state.settings.rolloverHour));

  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  const maxDay = $derived(Math.max(1, ...review.daily));

  const delta = $derived(review.completions - review.prevCompletions);

  let copied = $state(false);
  async function copyWins() {
    const text = weekWinsList(plainTasks, clock.now, app.state.settings.rolloverHour);
    try {
      await navigator.clipboard.writeText(text || '- (a quiet week)');
      copied = true;
      setTimeout(() => (copied = false), 2000);
    } catch {
      /* clipboard can be denied; the button simply doesn't confirm */
    }
  }

  const dayName = (key: string) =>
    new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' });
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'stats' })}>‹</button>
    <h1>This Week</h1>
  </header>

  <section class="panel hero" data-testid="week-hero">
    <span class="hero-num">{review.completions}</span>
    <span class="hero-label">done since Sunday</span>
    {#if review.prevCompletions > 0 || review.completions > 0}
      <span class="delta" class:up={delta >= 0} data-testid="week-delta">
        {delta >= 0 ? '▲' : '▼'} {Math.abs(delta)} vs last week ({review.prevCompletions})
      </span>
    {/if}
  </section>

  <section class="panel" data-testid="week-days">
    <div class="bars">
      {#each review.daily as count, i (i)}
        <div class="day">
          <span class="count" class:zero={count === 0}>{count || ''}</span>
          <div class="bar" style="height: {Math.round((count / maxDay) * 48)}px"></div>
          <span class="label">{DAY_LABELS[i]}</span>
        </div>
      {/each}
    </div>
    {#if review.bestDay && review.bestDay.count > 1}
      <p class="note">{dayName(review.bestDay.key)} carried the week — {review.bestDay.count} in one day.</p>
    {/if}
  </section>

  {#if review.trackedMs > 0}
    <section class="panel" data-testid="week-tracked">
      <span class="line">⧗ {formatElapsed(review.trackedMs)} of tracked focus</span>
      {#if review.estimates}
        <span class="line dim">
          estimates: {review.estimates.on} on the money · {review.estimates.under} beat it · {review.estimates.over} ran long
        </span>
      {/if}
    </section>
  {/if}

  {#if review.topWins.length > 0}
    <section class="panel" data-testid="week-wins">
      <div class="panel-head">
        <h2>headline wins</h2>
        <button class="copy" data-testid="week-copy" onclick={() => void copyWins()}>
          {copied ? 'copied ✓' : 'copy the week'}
        </button>
      </div>
      <ul>
        {#each review.topWins as t (t.id)}
          <li><Glyph name="check" size={11} /> {t.name || 'untitled'}</li>
        {/each}
      </ul>
    </section>
  {:else}
    <p class="empty">// the week is young — go press the big button</p>
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
  .hero .hero-num { font-family: var(--font-mono); font-size: 2.2rem; font-weight: 700; color: var(--acc-green); }
  .hero-label { color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem; }
  .delta { font-family: var(--font-mono); font-size: 0.75rem; color: var(--acc-magenta); }
  .delta.up { color: var(--acc-green); }

  .bars { display: flex; align-items: flex-end; gap: 8px; justify-content: space-between; }
  .day { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 3px; }
  .bar { width: 100%; max-width: 34px; background: var(--acc-green); opacity: 0.65; border-radius: 3px 3px 0 0; min-height: 2px; }
  .count { color: var(--acc-green); font-family: var(--font-mono); font-size: 0.68rem; min-height: 1em; }
  .count.zero { color: transparent; }
  .label { color: var(--dim); font-family: var(--font-mono); font-size: 0.65rem; }
  .note { margin: 4px 0 0; color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.72rem; }

  .line { font-family: var(--font-mono); font-size: 0.85rem; color: var(--text); }
  .line.dim { color: var(--dim); font-size: 0.72rem; }

  .panel-head { display: flex; align-items: baseline; justify-content: space-between; }
  h2 { font-family: var(--font-mono); font-size: 0.8rem; color: var(--dim); margin: 0; text-transform: uppercase; letter-spacing: 0.08em; }
  .copy {
    background: none; border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    padding: 4px 10px; cursor: pointer;
  }
  @media (hover: hover) { .copy:hover { color: var(--acc-cyan); border-color: var(--acc-cyan); } }
  ul { list-style: none; margin: 4px 0 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  li { display: flex; align-items: baseline; gap: 8px; font-size: 0.88rem; }
  li :global(svg) { color: var(--acc-green); flex: none; transform: translateY(1px); }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; }
</style>
