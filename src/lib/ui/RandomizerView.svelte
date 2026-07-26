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
  import { burstFromElement, motionOk } from './fx/particles';
  import { haptic } from './fx/haptics';
  import { shuffleReveal } from './fx/shuffle';

  let { listId }: { listId?: string } = $props();

  // List filter is an OMIT set: empty = all lists in (Ben's "all minus a few").
  // The list-scoped 🎲 entry seeds it with everything EXCEPT that list.
  // svelte-ignore state_referenced_locally
  let omittedLists = $state<string[]>(
    listId ? app.state.lists.filter((l) => l.id !== listId).map((l) => l.id) : [],
  );
  let filterTags = $state<string[]>([]);
  let notNow = $state<string[]>([]);
  let drawn = $state<Task | null>(null);
  let displayName = $state('');
  let drawSeq = $state(0);      // keys the card so the sheen replays per draw
  let accepting = $state(false);

  const scope = () => ({
    listIds: omittedLists.length
      ? app.state.lists.filter((l) => !omittedLists.includes(l.id)).map((l) => l.id)
      : undefined,
    tagIds: filterTags,
    excludeIds: notNow,
  });

  function redraw() {
    drawn = drawTask(app.state.tasks, app.state.settings, new Date(), Math.random, scope());
    if (drawn) {
      drawSeq += 1;
      shuffleReveal(drawn.name || 'untitled', (text) => (displayName = text));
    }
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

  function accept(e: MouseEvent) {
    if (!drawn || accepting) return;
    accepting = true;
    const id = drawn.id;
    try {
      burstFromElement(e.currentTarget as Element, { count: 24, power: 1.3 });
      haptic('heavy');
    } catch { /* fx must never block accepting */ }
    setTimeout(
      () => void app.acceptTask(id).then(() => navigate({ name: 'home' })),
      motionOk() ? 350 : 0,
    );
  }

  function resetSkips() {
    notNow = [];
    redraw();
  }

  function toggleListFilter(id: string) {
    omittedLists = omittedLists.includes(id)
      ? omittedLists.filter((x) => x !== id)
      : [...omittedLists, id];
    notNow = []; // filters define a fresh pool → fresh skip session
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
    {#if app.state.lists.length > 1}
      <div class="filter-row">
        <span class="filter-label">lists</span>
        {#each app.state.lists as l (l.id)}
          <button class="chip list-chip" class:on={!omittedLists.includes(l.id)}
            data-testid="draw-filter-list-{l.id}"
            onclick={() => toggleListFilter(l.id)}>{l.title}</button>
        {/each}
      </div>
    {/if}
    {#if app.state.tags.length > 0}
      <div class="filter-row">
        <span class="filter-label">tags</span>
        {#each app.state.tags as t (t.id)}
          <button class="chip" class:on={filterTags.includes(t.id)}
            style="--c: {tagColor(t.colorIndex)}"
            data-testid="draw-filter-tag-{t.id}"
            onclick={() => toggleTagFilter(t.id)}>
            <span class="dot"></span>{t.name}
          </button>
        {/each}
      </div>
    {/if}
  </div>

  {#if drawn}
    {#key drawSeq}
    <section class="card sheen-once" data-testid="draw-card">
      {#if drawnTier}
        <p class="tier {drawnTier}">
          drawn from: {drawnTier.toUpperCase()}{#if drawnEscalated}&nbsp;▲ deadline-escalated{/if}
        </p>
      {/if}
      <h2 class="task-name">{displayName}</h2>
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
    {/key}

    <div class="actions">
      <button class="accept" data-testid="draw-accept" disabled={accepting} onclick={accept}>accept — let's go</button>
      <div class="secondary">
        <button data-testid="draw-not-now" disabled={accepting} onclick={notNowClick}>not now</button>
        <button data-testid="draw-not-today" disabled={accepting} onclick={notTodayClick}>not today</button>
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
  .filter-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .filter-label {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.08em; margin-right: 2px;
  }
  .list-chip { --c: var(--acc-blue); }
  .list-chip.on { color: var(--acc-blue); }
  .list-chip:not(.on) { text-decoration: line-through; opacity: 0.55; }
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
