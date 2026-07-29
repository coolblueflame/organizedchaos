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
  import PrioritySelect from './PrioritySelect.svelte';
  import TaskEditor from './TaskEditor.svelte';
  import { burstFromElement, motionOk } from './fx/particles';
  import { haptic } from './fx/haptics';
  import { shuffleReveal } from './fx/shuffle';
  import { describeWindow, isListActiveAt, tasksBlockedByHours } from '../domain/schedule';
  import { projectPriorities } from '../domain/project';
  import { blockLifts } from '../domain/blocking';
  import { ritualExclusions, withRitualLifts } from '../domain/ritual';
  import { archivedTaskIds } from '../domain/archive';
  import { SELF_CARE } from '../eggs/content/extras';
  import { completionCounts } from '../domain/stats';
  import { priorityRank } from '../domain/types';
  import Glyph from './Glyph.svelte';

  let { listId }: { listId?: string } = $props();

  // Rolling from a specific list is an explicit choice, so scoped entry
  // ignores schedules entirely.
  // svelte-ignore state_referenced_locally
  let ignoringHours = $state(Boolean(listId));

  // Which lists are off the clock right now (for the 🌙 chip hints).
  const asleepLists = $derived(
    app.state.lists.filter((l) => !isListActiveAt(l, new Date())).map((l) => l.id),
  );

  /**
   * Tasks the clock is holding back. Computed per TASK, not per list, so a
   * list can be asleep while its urgent work still gets through.
   */
  const blockedByHours = $derived(
    ignoringHours
      ? []
      : tasksBlockedByHours(app.state.tasks, app.state.lists, app.state.settings, new Date()),
  );

  // List filter is an OMIT set: empty = all lists in (Ben's "all minus a few").
  // Purely manual now — the schedule works through blockedByHours instead.
  // svelte-ignore state_referenced_locally
  let omittedLists = $state<string[]>(
    listId ? app.state.lists.filter((l) => l.id !== listId).map((l) => l.id) : [],
  );
  let filterTags = $state<string[]>([]);

  // The filter panel is closed until asked for, and searchable once open —
  // a real library brings dozens of lists and hundreds of tags.
  let filtersOpen = $state(false);
  let listQuery = $state('');
  let tagQuery = $state('');
  const matches = (name: string, q: string) =>
    q.trim() === '' || name.toLowerCase().includes(q.trim().toLowerCase());
  const shownLists = $derived(
    app.state.lists.filter((l) => l.archived !== true && matches(l.title, listQuery)),
  );
  const shownTags = $derived(app.state.tags.filter((t) => matches(t.name, tagQuery)));

  /**
   * What the filters are currently doing, in words. A closed panel must never
   * hide the fact that the pool is narrowed — that would read as a broken
   * randomizer rather than a filter left on.
   */
  const filterSummary = $derived.by(() => {
    const parts: string[] = [];
    if (omittedLists.length) parts.push(`${omittedLists.length} list${omittedLists.length > 1 ? 's' : ''} off`);
    if (filterTags.length) parts.push(`${filterTags.length} tag${filterTags.length > 1 ? 's' : ''}`);
    return parts.length ? parts.join(' · ') : 'everything in';
  });
  let notNow = $state<string[]>([]);
  let drawn = $state<Task | null>(null);
  let editingDraw = $state(false);
  let displayName = $state('');
  let drawSeq = $state(0);      // keys the card so the sheen replays per draw
  let accepting = $state(false);

  const scope = () => ({
    listIds: omittedLists.length
      ? app.state.lists.filter((l) => !omittedLists.includes(l.id)).map((l) => l.id)
      : undefined,
    tagIds: filterTags,
    excludeIds: [...notNow, ...blockedByHours, ...ritualsNotDue, ...onShelf],
    // A running work period narrows the pool to what actually fits.
    maxEstimateHours: app.workPeriodHoursLeft() ?? undefined,
  });

  // Triage prompts: occasionally surface an untriaged task so the backlog gets
  // organized a bit at a time instead of in one grim pass. Once per visit.
  let triage = $state<Task | null>(null);
  let triageOffered = false;

  function maybeOfferTriage(): void {
    if (triageOffered) return;
    const pool = app.tasksNeedingReview();
    if (pool.length === 0) return;
    const automated = typeof navigator !== 'undefined' && navigator.webdriver;
    const forced = automated && localStorage.getItem('OC_EGG_FORCE') === 'triage';
    if (automated ? !forced : Math.random() > 0.18) return;
    triageOffered = true;
    triage = pool[Math.floor(Math.random() * pool.length)]!;
  }

  function finishTriage() {
    if (triage) void app.markReviewed(triage.id);
    triage = null;
    redraw();
  }

  // Transient bonus draws (spec §12): appear only when the day earned one or the
  // pool is calm; NEVER persisted unless explicitly accepted. Once per visit.
  let selfCare = $state<string | null>(null);
  let selfCareOffered = false;

  function maybeOfferSelfCare(): void {
    // Automation determinism: silent under webdriver unless explicitly forced.
    if (typeof navigator !== 'undefined' && navigator.webdriver) {
      if (localStorage.getItem('OC_EGG_FORCE') !== 'selfcare' || selfCareOffered) return;
      selfCareOffered = true;
      selfCare = SELF_CARE[0]!;
      return;
    }
    if (selfCareOffered || Math.random() > 0.12) return;
    const counts = completionCounts(app.state.tasks, new Date(), app.state.settings.rolloverHour);
    const calmPool = drawn === null ||
      priorityRank(effectivePriority(drawn, app.state.settings, new Date())) <= priorityRank('medium');
    if (counts.today >= 6 || calmPool) {
      selfCareOffered = true;
      selfCare = SELF_CARE[Math.floor(Math.random() * SELF_CARE.length)]!;
    }
  }

  const projectTiers = $derived(
    projectPriorities(app.state.lists, app.state.tasks, app.state.settings, new Date()),
  );
  /**
   * Daily rituals that are not due right now — done today, or outside their
   * window. Excluded rather than de-prioritised: "eat lunch" at 4pm is not a
   * low-priority suggestion, it is not a suggestion.
   */
  /** Tasks on archived lists — never proposed, always findable. */
  const onShelf = $derived(archivedTaskIds(app.state.tasks, app.state.lists));

  const ritualsNotDue = $derived(
    ritualExclusions(app.state.tasks, app.state.settings, new Date()),
  );

  /** Blockers inherit the urgency of whatever is waiting on them (§blocking). */
  const lifts = $derived(
    withRitualLifts(
      blockLifts(app.state.tasks, app.state.settings, new Date()),
      app.state.tasks, app.state.settings, new Date(),
    ),
  );

  function redraw() {
    drawn = drawTask(
      app.state.tasks, app.state.settings, new Date(), Math.random, scope(), projectTiers, lifts,
    );
    if (drawn) {
      drawSeq += 1;
      shuffleReveal(drawn.name || 'untitled', (text) => (displayName = text));
    }
    maybeOfferTriage();
    if (!triage) maybeOfferSelfCare();
  }

  /** Accepting materializes it as a REAL task — that's the consent (spec §12).
   *  It lands in the dice's own list, not whichever list was touched last. */
  async function acceptSelfCare() {
    if (!selfCare) return;
    const task = await app.materializeGeneratedTask(selfCare);
    await app.acceptTask(task.id);
    selfCare = null;
    navigate({ name: 'home' });
  }

  /** Would anything be drawable if we forgot the session skips? */
  const skipsAreTheProblem = $derived.by(() => {
    if (drawn !== null) return false;
    const without = { ...scope(), excludeIds: [...blockedByHours] };
    return eligibleForDraw(app.state.tasks, new Date(), without).length > 0;
  });

  /**
   * Empty only because everything left is waiting on something else? Worth
   * naming: a blocked task is invisible to the draw but still sitting in the
   * user's lists, so "pool empty" alone reads as a bug.
   */
  const blockersAreTheProblem = $derived.by(() => {
    if (drawn !== null) return false;
    // Only `includeBlocked` changes, so a true result isolates blocking as
    // the cause — the skip and hours cases are already ruled out above.
    const relaxed = { ...scope(), includeBlocked: true };
    return eligibleForDraw(app.state.tasks, new Date(), relaxed).length > 0;
  });

  /** Empty only because the clock is holding things back? */
  const hoursAreTheProblem = $derived.by(() => {
    if (drawn !== null || blockedByHours.length === 0) return false;
    const without = { ...scope(), excludeIds: [...notNow] };
    return eligibleForDraw(app.state.tasks, new Date(), without).length > 0;
  });

  function ignoreHours() {
    ignoringHours = true;
    notNow = [];
    redraw();
  }

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

  {#if triage}
    <section class="card triage sheen-once" data-testid="draw-triage">
      <p class="tier fillin">✎ fill in this one</p>
      <h2 class="task-name">{triage.name || 'untitled'}</h2>
      <p class="list-name">
        from {app.state.lists.find((l) => l.id === triage!.listId)?.title ?? 'your lists'}
        · a quick once-over and it's properly in the system
      </p>
      <div class="triage-fields">
        <PrioritySelect value={triage.priority}
          onchange={(p) => void app.patchTask(triage!.id, { priority: p })} />
        <!-- Filing it somewhere better IS filling it in — the same re-file the
             sweep offers (2026-07-28 request). -->
        <label class="triage-move"><span>list</span>
          <select data-testid="triage-move" value={triage.listId}
            onchange={(e) => void app.moveTask(triage!.id, e.currentTarget.value)}>
            {#each app.state.lists.filter((l) => l.archived !== true) as l (l.id)}
              <option value={l.id}>{l.title}</option>
            {/each}
          </select>
        </label>
        <label class="triage-notes"><span>description</span>
          <textarea data-testid="triage-notes" rows="2" placeholder="what does this actually involve?"
            value={triage.notes}
            oninput={(e) => void app.patchTask(triage!.id, { notes: e.currentTarget.value })}></textarea>
        </label>
        <div class="triage-row">
          <label><span>deadline</span>
            <input type="date" data-testid="triage-deadline" value={triage.deadline ?? ''}
              oninput={(e) => void app.patchTask(triage!.id, { deadline: e.currentTarget.value || undefined })} />
          </label>
          <label><span>estimate (h)</span>
            <input type="number" min="0.5" step="0.5" placeholder="1" data-testid="triage-estimate"
              value={triage.estimateHours ?? ''}
              oninput={(e) => void app.patchTask(triage!.id, {
                estimateHours: parseFloat(e.currentTarget.value) > 0 ? parseFloat(e.currentTarget.value) : undefined,
              })} />
          </label>
        </div>
      </div>
    </section>
    <div class="actions">
      <button class="accept" data-testid="triage-done" onclick={finishTriage}>done — roll for real</button>
      <div class="secondary">
        <button data-testid="triage-skip" onclick={() => { triage = null; redraw(); }}>skip for now</button>
      </div>
    </div>
  {:else if selfCare}
    <section class="card selfcare sheen-once" data-testid="draw-selfcare">
      <p class="tier bonus">✦ bonus roll</p>
      <h2 class="task-name">{selfCare}</h2>
      <p class="list-name">not from your list — just for you. skipping leaves no trace.</p>
    </section>
    <div class="actions">
      <button class="accept" data-testid="selfcare-accept" onclick={acceptSelfCare}>sure — make it my task</button>
      <div class="secondary">
        <button data-testid="selfcare-skip" onclick={() => (selfCare = null)}>maybe later</button>
      </div>
    </div>
  {:else if drawn}
    {#key drawSeq}
    <section class="card sheen-once" data-testid="draw-card">
      {#if drawnTier}
        <p class="tier {drawnTier}">
          drawn from: {drawnTier.toUpperCase()}{#if drawnEscalated}&nbsp;▲ deadline-escalated{/if}
        </p>
      {/if}
      <button class="task-name-btn" data-testid="draw-edit-toggle"
        onclick={() => { editingDraw = !editingDraw; if (editingDraw) void app.markReviewed(drawn!.id); }}>
        <h2 class="task-name">{displayName}</h2>
        <span class="edit-hint">{editingDraw ? '▴ done editing' : '✎ tweak it'}</span>
      </button>
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

      {#if editingDraw}
        <div class="draw-editor">
          <TaskEditor task={drawn} oncollapse={() => (editingDraw = false)} />
        </div>
      {/if}
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
      {:else if hoursAreTheProblem}
        <p class="with-glyph">// everything left is on a list that's off the clock right now <Glyph name="moon" size={11} /></p>
        <button class="reset" data-testid="draw-ignore-hours" onclick={ignoreHours}>roll anyway</button>
      {:else if app.workPeriodHoursLeft() !== null}
        <p class="with-glyph">// nothing fits the time left in your work period <Glyph name="period" size={11} /></p>
        <button class="reset" data-testid="draw-end-period"
          onclick={() => void app.endWorkPeriod().then(redraw)}>end the period and roll anyway</button>
      {:else if blockersAreTheProblem}
        <p class="with-glyph" data-testid="draw-all-blocked">// everything left is waiting on another task <Glyph name="blocked" size={11} /></p>
        <button class="reset" onclick={() => navigate({ name: 'home' })}>go home</button>
      {:else}
        <p>// pool empty — everything's done, filtered out, or snoozed until 4am</p>
        <button class="reset" onclick={() => navigate({ name: 'home' })}>go home</button>
      {/if}
    </section>
  {/if}

  <!--
    Filters live BELOW the roll and start closed. A real library has dozens of
    lists and over a hundred tags, and a wall of chips above the result buries
    the one thing this screen exists to show. The summary line carries whatever
    is currently narrowing the pool, so a filter can never be silently on.
  -->
  {#if app.state.lists.length > 1 || app.state.tags.length > 0}
    <section class="filters" class:open={filtersOpen}>
      <button class="filter-toggle" data-testid="draw-filters-toggle"
        aria-expanded={filtersOpen} onclick={() => (filtersOpen = !filtersOpen)}>
        <span class="caret">{filtersOpen ? '▾' : '▸'}</span> filters
        <span class="filter-summary">{filterSummary}</span>
      </button>

      {#if filtersOpen}
        {#if app.state.lists.length > 1}
          <div class="filter-row">
            <span class="filter-label">lists</span>
            <input class="filter-search" data-testid="draw-search-lists"
              placeholder="find a list…" bind:value={listQuery} />
            {#if omittedLists.length}
              <button class="filter-clear" data-testid="draw-filter-lists-all"
                onclick={() => (omittedLists = [])}>all back on</button>
            {/if}
          </div>
          <div class="filter-row chips">
            {#each shownLists as l (l.id)}
              <button class="chip list-chip" class:on={!omittedLists.includes(l.id)}
                data-testid="draw-filter-list-{l.id}"
                title={describeWindow(l)
                  ? `scheduled ${describeWindow(l)}${l.urgentOverridesHours ? ' · urgent still gets through' : ''}`
                  : undefined}
                onclick={() => toggleListFilter(l.id)}>
                {#if asleepLists.includes(l.id) && !ignoringHours}<Glyph name="moon" size={11} />{#if l.urgentOverridesHours}<Glyph name="bolt" size={11} />{/if}&nbsp;{/if}{l.title}
              </button>
            {/each}
            {#if shownLists.length === 0}<span class="filter-none">nothing matches “{listQuery}”</span>{/if}
          </div>
        {/if}
        {#if app.state.tags.length > 0}
          <div class="filter-row">
            <span class="filter-label">tags</span>
            <input class="filter-search" data-testid="draw-search-tags"
              placeholder="find a tag…" bind:value={tagQuery} />
            {#if filterTags.length}
              <button class="filter-clear" data-testid="draw-filter-tags-clear"
                onclick={() => (filterTags = [])}>clear</button>
            {/if}
          </div>
          <div class="filter-row chips">
            {#each shownTags as t (t.id)}
              <button class="chip" class:on={filterTags.includes(t.id)}
                style="--c: {tagColor(t.colorIndex)}"
                data-testid="draw-filter-tag-{t.id}"
                onclick={() => toggleTagFilter(t.id)}>
                <span class="dot"></span>{t.name}
              </button>
            {/each}
            {#if shownTags.length === 0}<span class="filter-none">nothing matches “{tagQuery}”</span>{/if}
          </div>
        {/if}
      {/if}
    </section>
  {/if}
</main>

<style>
  .with-glyph { display: inline-flex; align-items: center; gap: 6px; justify-content: center; }

  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--dim); font-size: 1.2rem; cursor: pointer; padding: 4px 8px; }
  .back:hover { color: var(--text); }
  h1 { font-family: var(--font-mono); font-size: 1.1rem; margin: 0; color: var(--acc-purple); }

  .filters {
    display: flex; flex-direction: column; gap: 8px; margin-top: 28px;
    border-top: 1px solid var(--line); padding-top: 12px;
  }
  .filter-toggle {
    background: none; border: none; padding: 4px 0; cursor: pointer; text-align: left;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.78rem;
    display: flex; align-items: center; gap: 6px;
  }
  .filter-toggle:hover { color: var(--text); }
  .caret { color: var(--acc-purple); }
  .filter-summary { color: var(--acc-cyan); }
  .filter-search {
    flex: 1; min-width: 120px; background: var(--bg2); border: 1px solid var(--line);
    border-radius: 6px; color: var(--text); padding: 5px 8px; font-size: 0.78rem; outline: none;
  }
  .filter-search:focus { border-color: var(--acc-blue); }
  .filter-clear {
    background: none; border: none; color: var(--acc-blue); cursor: pointer;
    font-size: 0.72rem; text-decoration: underline; padding: 2px 4px;
  }
  .filter-none { color: var(--dim); font-size: 0.75rem; }
  .filter-row { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  /* Long lists of chips scroll rather than pushing the page down forever. */
  .filter-row.chips { max-height: 168px; overflow-y: auto; }
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
      max-width: 100%; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
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
  .tier.bonus { color: var(--acc-yellow); }
  .selfcare { border-color: var(--acc-yellow); }
  .tier.fillin { color: var(--acc-yellow); font-size: 0.95rem; }
  .triage { border-color: var(--acc-yellow); }
  .triage-fields { display: flex; flex-direction: column; gap: 10px; margin-top: 12px; }
  /*
    A grid that stacks on a phone rather than a two-column flex row. A native
    date control will not shrink below the date it has to show, so splitting a
    narrow screen in half squeezed it to a stub — the same failure the task
    editor had, fixed the same way.
  */
  .triage-row { display: grid; grid-template-columns: 1fr; gap: 10px 12px; }
  @media (min-width: 440px) {
    .triage-row { grid-template-columns: 1fr 1fr; }
  }
  .triage-row label, .triage-notes, .triage-move { display: flex; flex-direction: column; gap: 4px; }
  .triage-row span, .triage-notes span, .triage-move span {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
  }
  .triage-move select {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 7px 8px; font-size: 0.85rem; outline: none;
    width: 100%; max-width: 100%; min-width: 0;
  }
  .triage-row input, .triage-notes textarea {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 7px 8px; font-size: 0.85rem; outline: none;
    color-scheme: dark; width: 100%;
  }
  .triage-notes textarea { font-family: inherit; resize: vertical; line-height: 1.45; }
  .triage-notes textarea:focus, .triage-row input:focus { border-color: var(--acc-blue); }
  .task-name { font-size: 1.4rem; margin: 0 0 4px; }
  .task-name-btn {
    background: none; border: none; padding: 0; text-align: left; width: 100%;
    color: inherit; cursor: pointer; display: block;
  }
  .edit-hint { color: var(--dim); font-family: var(--font-mono); font-size: 0.65rem; }
  .task-name-btn:hover .edit-hint { color: var(--acc-cyan); }
  .draw-editor { border-top: 1px solid var(--line); margin-top: 12px; padding-top: 10px; }
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
