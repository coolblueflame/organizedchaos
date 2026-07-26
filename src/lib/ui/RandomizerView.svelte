<!--
  The randomizer (spec §4 + 2026-07-26 amendment). Draws from the highest
  effective-priority tier via the pure domain drawTask. The "Not Now" exclusion
  set lives HERE and only here — session-only by design; closing the screen
  forgets it. Filters (list/tag) reset the session. Phase 5 replaces the plain
  reveal with the slot-machine shuffle.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { drawTask, eligibleForDraw } from '../domain/randomizer';
  import { effectivePriority, isEscalated } from '../domain/priority';
  import type { Task } from '../domain/types';
  import { tagColor } from './tagColors';

  let { listId }: { listId?: string } = $props();

  // Route param only SEEDS the filter — the user can change it after entry.
  // svelte-ignore state_referenced_locally
  let filterList = $state<string>(listId ?? '');
  let filterTags = $state<string[]>([]);
  let notNow = $state<string[]>([]);
  let drawn = $state<Task | null>(null);

  const scope = () => ({
    listId: filterList || undefined,
    tagIds: filterTags,
    excludeIds: notNow,
  });

  function redraw() {
    drawn = drawTask(app.state.tasks, app.state.settings, new Date(), Math.random, scope());
  }

  /** Would anything be drawable if we forgot the session skips? */
  const skipsAreTheProblem = $derived.by(() => {
    if (drawn !== null) return false;
    const without = { ...scope(), excludeIds: [] };
    return eligibleForDraw(app.state.tasks, new Date(), without).length > 0;
  });

  function notNowClick() {
    if (!drawn) return;
    notNow = [...notNow, drawn.id];
    redraw();
  }

  async function notTodayClick() {
    if (!drawn) return;
    await app.sendNotToday(drawn.id);
    redraw();
  }

  async function accept() {
    if (!drawn) return;
    await app.acceptTask(drawn.id);
    navigate({ name: 'home' });
  }

  function resetSkips() {
    notNow = [];
    redraw();
  }

  function setListFilter(value: string) {
    filterList = value;
    notNow = [];
    redraw();
  }

  function toggleTagFilter(tagId: string) {
    filterTags = filterTags.includes(tagId)
      ? filterTags.filter((id) => id !== tagId)
      : [...filterTags, tagId];
    notNow = [];
    redraw();
  }

  const drawnList = $derived(drawn ? app.state.lists.find((l) => l.id === drawn!.listId) : undefined);
  const drawnTier = $derived(drawn ? effectivePriority(drawn, app.state.settings, new Date()) : null);
  const drawnEscalated = $derived(drawn ? isEscalated(drawn, app.state.settings, new Date()) : false);
  const drawnTags = $derived(drawn
    ? drawn.tagIds.map((id) => app.state.tags.find((t) => t.id === id)).filter((t) => t !== undefined)
    : []);

  redraw(); // first draw on mount
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>✕</button>
    <h1>the randomizer</h1>
  </header>

  <div class="filters">
    <select data-testid="draw-filter-list" value={filterList}
      onchange={(e) => setListFilter(e.currentTarget.value)}>
      <option value="">all lists</option>
      {#each app.state.lists as l (l.id)}
        <option value={l.id}>{l.title}</option>
      {/each}
    </select>
    <div class="tag-filters">
      {#each app.state.tags as t (t.id)}
        <button class="chip" class:on={filterTags.includes(t.id)}
          style="--c: {tagColor(t.colorIndex)}"
          data-testid="draw-filter-tag-{t.id}"
          onclick={() => toggleTagFilter(t.id)}>
          <span class="dot"></span>{t.name}
        </button>
      {/each}
    </div>
  </div>

  {#if drawn}
    <section class="card" data-testid="draw-card">
      {#if drawnTier}
        <p class="tier {drawnTier}">
          drawn from: {drawnTier.toUpperCase()}{#if drawnEscalated}&nbsp;▲ deadline-escalated{/if}
        </p>
      {/if}
      <h2 class="task-name">{drawn.name || 'untitled'}</h2>
      {#if drawnList}<p class="list-name">in {drawnList.title}</p>{/if}
      {#if drawn.notes}<p class="notes">{drawn.notes.slice(0, 200)}</p>{/if}
      <div class="meta">
        {#each drawnTags as t (t.id)}
          <span class="chip on" style="--c: {tagColor(t.colorIndex)}"><span class="dot"></span>{t.name}</span>
        {/each}
        {#if drawn.deadline}<span class="pill">due {drawn.deadline}</span>{/if}
        {#if drawn.estimateHours}<span class="pill">~{drawn.estimateHours}h</span>{/if}
        {#if drawn.inProgress}<span class="pill started">in progress</span>{/if}
      </div>
    </section>

    <div class="actions">
      <button class="accept" data-testid="draw-accept" onclick={accept}>accept — let's go</button>
      <div class="secondary">
        <button data-testid="draw-not-now" onclick={notNowClick}>not now</button>
        <button data-testid="draw-not-today" onclick={notTodayClick}>not today</button>
      </div>
    </div>
  {:else}
    <section class="empty" data-testid="draw-empty">
      {#if skipsAreTheProblem}
        <p>// you've skipped everything in the pool</p>
        <button class="reset" data-testid="draw-reset-skips" onclick={resetSkips}>reset skips</button>
      {:else}
        <p>// pool empty — everything's done, filtered out, or snoozed until 4am</p>
        <button class="reset" onclick={() => navigate({ name: 'home' })}>go home</button>
      {/if}
    </section>
  {/if}
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--dim); font-size: 1.2rem; cursor: pointer; padding: 4px 8px; }
  .back:hover { color: var(--text); }
  h1 { font-family: var(--font-mono); font-size: 1.1rem; margin: 0; color: var(--acc-purple); }

  .filters { display: flex; flex-direction: column; gap: 8px; margin-bottom: 20px; }
  select {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.8rem; padding: 8px;
  }
  .tag-filters { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 999px;
    color: var(--dim); font-size: 0.75rem; padding: 4px 10px; cursor: pointer;
  }
  .chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); opacity: 0.5; }
  .chip.on { color: var(--text); border-color: var(--c); }
  .chip.on .dot { opacity: 1; }

  .card {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 12px;
    padding: 20px; animation: reveal 0.25s ease-out;
  }
  @keyframes reveal { from { opacity: 0; transform: translateY(8px); } }
  .tier { font-family: var(--font-mono); font-size: 0.7rem; margin: 0 0 8px; text-transform: uppercase; letter-spacing: 0.08em; }
  .tier.someday { color: var(--dim); }
  .tier.low { color: var(--acc-blue); }
  .tier.medium { color: var(--acc-green); }
  .tier.high { color: var(--acc-orange); }
  .tier.max { color: var(--acc-magenta); }
  .task-name { font-size: 1.4rem; margin: 0 0 4px; }
  .list-name { color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; margin: 0 0 10px; }
  .notes { color: var(--dim); font-size: 0.85rem; margin: 0 0 10px; white-space: pre-line; }
  .meta { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .pill {
    background: var(--bg2); border-radius: 999px; color: var(--dim);
    font-family: var(--font-mono); font-size: 0.7rem; padding: 3px 10px;
  }
  .pill.started { color: var(--acc-cyan); }

  .actions { margin-top: 20px; display: flex; flex-direction: column; gap: 10px; }
  .accept {
    background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 10px;
    color: var(--acc-green); font-family: var(--font-mono); font-size: 1rem; font-weight: 700;
    padding: 14px; cursor: pointer;
  }
  .accept:hover { background: var(--acc-green); color: var(--bg0); }
  .secondary { display: flex; gap: 10px; }
  .secondary button {
    flex: 1; background: none; border: 1px solid var(--line); border-radius: 10px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem;
    padding: 10px; cursor: pointer;
  }
  .secondary button:hover { color: var(--text); border-color: var(--dim); }

  .empty { text-align: center; padding: 40px 0; }
  .empty p { color: var(--dim); font-family: var(--font-mono); font-size: 0.9rem; }
  .reset {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.85rem;
    padding: 10px 20px; cursor: pointer;
  }
</style>
