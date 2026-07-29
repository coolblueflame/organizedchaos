<!--
  Completed history (spec §6): every finished task grouped by completion
  app-day (4am rule), newest first, with one-tap restore.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { groupCompleted } from '../domain/views';
  import { appDayKey } from '../domain/time';
  import { winsList } from '../domain/stats';
  import TaskRow from './TaskRow.svelte';
  import { revealOnApproach } from './lazyReveal';

  let openId = $state<string | null>(null);

  const groups = $derived(
    groupCompleted(app.state.tasks, app.state.settings.rolloverHour),
  );

  /*
    Rows mount a page at a time. An imported library holds YEARS of completions
    — tens of thousands of rows — and building a component for each froze this
    screen solid the moment it opened. Newest days come first, so the head of
    the list is exactly what a visit here is for; the rest arrives on approach.
    The budget only grows — resetting on data changes would yank the scroll.
  */
  const PAGE = 60;
  let budget = $state(PAGE);
  const total = $derived(groups.reduce((n, g) => n + g.tasks.length, 0));
  const shown = $derived.by(() => {
    let left = budget;
    const out: Array<{ key: string; label: string; tasks: typeof groups[number]['tasks'] }> = [];
    for (const group of groups) {
      if (left <= 0) break;
      out.push({ ...group, tasks: group.tasks.slice(0, left) });
      left -= Math.min(left, group.tasks.length);
    }
    return out;
  });
  const rendered = $derived(shown.reduce((n, g) => n + g.tasks.length, 0));

  // ── share today's wins ───────────────────────────────────────────────────
  const wins = $derived(winsList(app.state.tasks, new Date(), app.state.settings.rolloverHour));
  const winCount = $derived(wins === '' ? 0 : wins.split('\n').length);
  let copied = $state(false);
  let copyFailed = $state(false);

  /**
   * Clipboard access is gated on a user gesture and can be refused outright
   * (permissions, insecure context, an older browser). Falling back to the
   * legacy execCommand path means the button still works in those cases
   * instead of silently doing nothing.
   */
  async function copyWins() {
    if (!wins) return;
    copyFailed = false;
    try {
      await navigator.clipboard.writeText(wins);
    } catch {
      const ta = document.createElement('textarea');
      ta.value = wins;
      ta.setAttribute('readonly', '');
      ta.style.position = 'fixed';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.select();
      let ok = false;
      try {
        ok = document.execCommand('copy');
      } catch { /* nothing else to try */ }
      ta.remove();
      if (!ok) {
        copyFailed = true;
        return;
      }
    }
    copied = true;
    setTimeout(() => (copied = false), 2200);
  }

  function dayLabel(key: string): string {
    const rollover = app.state.settings.rolloverHour;
    const today = appDayKey(new Date(), rollover);
    if (key === today) return 'Today';
    const y = new Date();
    y.setDate(y.getDate() - 1);
    if (key === appDayKey(y, rollover)) return 'Yesterday';
    return key;
  }
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>Completed</h1>
  </header>

  {#if winCount > 0}
    <div class="wins">
      <button class="copy" data-testid="copy-wins" onclick={() => void copyWins()}>
        {copied
          ? `copied ${winCount} win${winCount === 1 ? '' : 's'}`
          : `copy today's ${winCount} win${winCount === 1 ? '' : 's'}`}
      </button>
      <span class="wins-hint">
        {#if copyFailed}
          couldn't reach the clipboard — select the list below instead
        {:else}
          a dash-bulleted list, ready to paste anywhere
        {/if}
      </span>
      {#if copyFailed}
        <textarea class="fallback" data-testid="copy-wins-fallback" readonly value={wins}></textarea>
      {/if}
    </div>
  {/if}

  <section class="groups">
    {#each shown as group (group.key)}
      <h2 class="group-header">{dayLabel(group.key)}</h2>
      {#each group.tasks as task (task.id)}
        <TaskRow {task} completedMode showList expanded={openId === task.id}
          ontoggle={() => (openId = openId === task.id ? null : task.id)} />
      {/each}
    {/each}
    {#if rendered < total}
      <div class="more" use:revealOnApproach={() => (budget += PAGE)} data-testid="rows-more">
        {rendered} of {total} — scroll for more
      </div>
    {/if}
    {#if groups.length === 0}
      <p class="empty">// nothing completed yet — the button awaits</p>
    {/if}
  </section>
</main>

<style>
  .wins {
    display: flex; flex-direction: column; align-items: flex-start; gap: 6px;
    margin-bottom: 16px;
  }
  .copy {
    background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 8px;
    color: var(--acc-green); font-family: var(--font-mono); font-size: 0.78rem;
    font-weight: 700; padding: 9px 14px; cursor: pointer;
  }
  .copy:hover { background: var(--acc-green); color: var(--bg0); }
  .wins-hint { color: var(--dim); font-family: var(--font-mono); font-size: 0.64rem; }
  .fallback {
    width: 100%; min-height: 90px; resize: vertical;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.78rem; padding: 8px;
  }
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .groups { display: flex; flex-direction: column; gap: 6px; }
  .more {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    text-align: center; padding: 14px 0 4px;
  }
  .group-header {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 14px 0 2px; font-weight: 600;
  }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; }
</style>
