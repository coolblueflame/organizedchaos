<!--
  Home screen (spec §6). This phase: sort-view row, grouped lists with CRUD,
  completed link. Phase 3 adds the big randomizer button + current task card
  here; Phase 8 adds the stats strip above everything.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { toast } from './toast.svelte';
  import { openTasks } from '../domain/views';
  import { describeWindow, isListActiveAt } from '../domain/schedule';
  import { projectPriorities } from '../domain/project';
  import { moveAcross, sameGrouping, sortLists, type GroupedIds } from '../domain/listOrder';
  import { isRitualDue } from '../domain/ritual';
  import ListSettings from './ListSettings.svelte';
  import { flip } from 'svelte/animate';
  import { motionOk } from './fx/particles';
  import type { List } from '../domain/types';
  import { nextPhrase } from './phrases';
  import CurrentTaskCard from './CurrentTaskCard.svelte';
  import StatsStrip from './StatsStrip.svelte';
  import Companion from '../eggs/Companion.svelte';
  import QuickAdd from './QuickAdd.svelte';
  import InstallBanner from './InstallBanner.svelte';
  import WorkPeriod from './WorkPeriod.svelte';
  import { haptic } from './fx/haptics';
  import Glyph from './Glyph.svelte';

  let quickAddOpen = $state(false);

  const phrase = nextPhrase();

  function bigButton() {
    haptic('tick');
    app.fireEgg('bigButtonPressed');
    navigate({ name: 'randomizer' });
  }

  // A little ritual for the curious: rapid taps on the wordmark do… something.
  let tapTimes: number[] = [];
  function wordmarkTap() {
    const now = Date.now();
    tapTimes = [...tapTimes.filter((t) => now - t < 3000), now];
    if (tapTimes.length >= 7) {
      tapTimes = [];
      app.grantUnlockAndShow('chaos-word');
    }
  }

  let newListOpen = $state(false);
  let newListInput = $state<HTMLInputElement | null>(null);
  let newListTitle = $state('');
  let settingsForId = $state<string | null>(null);
  const settingsFor = $derived(
    settingsForId ? app.state.lists.find((l) => l.id === settingsForId) ?? null : null,
  );

  const open = $derived(openTasks(app.state.tasks));
  const countFor = (listId: string) => open.filter((t) => t.listId === listId).length;
  const inProgressCount = $derived(open.filter((t) => t.inProgress).length);

  /**
   * How heavy a list is next to the heaviest one, as a percentage.
   *
   * Deliberately NOT a completion bar: a library imported from years of history
   * is almost entirely completed tasks, so "percent done" would read as 99% for
   * everything and mean nothing. How much is left, relative to the fullest list,
   * is a thing you can actually act on.
   */
  const heaviestList = $derived(
    Math.max(1, ...app.state.lists.map((l) => open.filter((t) => t.listId === l.id).length)),
  );
  const loadShare = (listId: string) =>
    Math.round((countFor(listId) / heaviestList) * 100);
  const recurringCount = $derived(app.state.templates.filter((t) => !t.deleted).length);
  // The Rituals link appears once any exist — a fifth footer row must earn its place.
  const ritualCount = $derived(
    app.state.tasks.filter((t) => !t.deleted && t.ritual !== undefined).length,
  );
  const reviewCount = $derived(app.tasksNeedingReview().length);
  const ritualsDue = $derived(
    app.state.tasks.filter((t) =>
      !t.deleted && isRitualDue(t, new Date(), app.state.settings.rolloverHour)).length,
  );

  /** Lists bucketed by areaGroup: ungrouped first, then groups alphabetically. */
  const grouped = $derived.by(() => {
    const buckets = new Map<string, List[]>();
    for (const l of app.state.lists) {
      const key = l.areaGroup?.trim() ?? '';
      const bucket = buckets.get(key) ?? [];
      bucket.push(l);
      buckets.set(key, bucket);
    }
    return [...buckets.entries()]
      .map(([key, bucket]) => [key, sortLists(bucket)] as [string, List[]])
      .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b)));
  });

  // ── drag to reorder (2026-07-28 request) ─────────────────────────────────
  // Same contract as the task rows: the drag starts on a grip that carries
  // `touch-action: none`, so a finger anywhere else on the row still scrolls.
  /* Rows slide apart to show where a drag will land — the indicator IS the
     motion, so with reduced motion they simply jump. */
  const rowFlipMs = motionOk() ? 180 : 0;

  let dragId = $state<string | null>(null);
  /**
   * Live grouping while dragging, so the screen reflows under your finger —
   * every group, not just the one you started in, because dragging a row past
   * a heading is how a list changes group.
   */
  let dragGroups = $state<GroupedIds | null>(null);
  /** The group the finger is currently over, for highlighting the destination. */
  let dragOverGroup = $state<string | null>(null);
  let dragStartGroup: string | null = null;

  function startListDrag(e: PointerEvent, group: string, id: string) {
    e.preventDefault();
    dragId = id;
    dragStartGroup = group;
    dragOverGroup = group;
    dragGroups = new Map(grouped.map(([g, lists]) => [g, lists.map((l) => l.id)]));
  }

  function onListDragMove(e: PointerEvent) {
    if (!dragId || !dragGroups) return;

    // Which group is the finger in? The heading directly above it wins, so
    // dragging past a heading moves the list into that section.
    let group = grouped[0]?.[0] ?? '';
    for (const el of document.querySelectorAll<HTMLElement>('[data-group-start]')) {
      if (e.clientY >= el.getBoundingClientRect().top) group = el.dataset.groupStart!;
    }

    // And where among that group's rows? Compare against each row's midpoint so
    // the list opens up as soon as the finger passes half way, rather than
    // waiting until it is fully over the next row.
    const rows = [...document.querySelectorAll<HTMLElement>('[data-list-row]')]
      .filter((el) => el.dataset.listGroup === group && el.dataset.listRow !== dragId);
    let index = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const box = rows[i]!.getBoundingClientRect();
      if (e.clientY < box.top + box.height / 2) { index = i; break; }
    }

    const next = moveAcross(dragGroups, dragId, group, index);
    dragOverGroup = group;
    if (!sameGrouping(next, dragGroups)) {
      dragGroups = next;
      haptic('tick');
    }
  }

  async function endListDrag() {
    const groups = dragGroups;
    const id = dragId;
    const from = dragStartGroup;
    dragId = null;
    dragGroups = null;
    dragOverGroup = null;
    dragStartGroup = null;
    if (!groups || !id) return;
    // Changing section is a property of the list; the sequence is everything else.
    const landedIn = [...groups.entries()].find(([, ids]) => ids.includes(id))?.[0] ?? from;
    if (landedIn !== from) await app.moveListToGroup(id, landedIn ?? '');
    for (const ids of groups.values()) await app.reorderLists(ids);
  }

  /** The sequence to render for a group: the live drag order if there is one. */
  const shownLists = (group: string, lists: List[]): List[] => {
    const order = dragGroups?.get(group);
    if (!order) return lists;
    const byId = new Map(app.state.lists.map((l) => [l.id, l]));
    return order.map((id) => byId.get(id)).filter((l): l is List => l !== undefined);
  };

  async function createList() {
    const title = newListTitle.trim();
    if (!title) { newListOpen = false; return; }
    const list = await app.addList(title);
    newListTitle = '';
    newListOpen = false;
    navigate({ name: 'list', id: list.id });
  }

  const projectTiers = $derived(
    projectPriorities(app.state.lists, app.state.tasks, app.state.settings, new Date()),
  );

  $effect(() => {
    if (newListOpen) newListInput?.focus();
  });
</script>

<svelte:window onpointermove={onListDragMove} onpointerup={() => void endListDrag()} />

<main>
  <h1 class="wordmark" onpointerdown={wordmarkTap}>organized<span class="accent">chaos</span><span class="cursor">▊</span></h1>
  <p class="tagline">// a todo list with a gambling problem</p>

  <InstallBanner />

  <StatsStrip />

  <CurrentTaskCard />

  <WorkPeriod />

  <button class="big-button" data-testid="big-button" onclick={bigButton}>
    {phrase}
  </button>

  <div class="capture-row">
    <button class="search-bar" data-testid="search-entry" onclick={() => navigate({ name: 'search' })}>
      <span class="mag">⌕</span> search everything…
    </button>
    {#if app.state.lists.length > 0}
      <button class="quick-add" data-testid="quick-add-open" onclick={() => (quickAddOpen = true)}>
        + todo
      </button>
    {/if}
  </div>

  <nav class="sort-row">
    <button data-testid="sort-date" onclick={() => navigate({ name: 'sort', mode: 'date' })}>by date</button>
    <button data-testid="sort-priority" onclick={() => navigate({ name: 'sort', mode: 'priority' })}>by priority</button>
    <button data-testid="sort-tag" onclick={() => navigate({ name: 'sort', mode: 'tag' })}>by tag</button>
  </nav>

  {#if reviewCount > 0}
    <button class="sweep-banner" data-testid="sweep-banner" onclick={() => navigate({ name: 'sweep' })}>
      <span class="sweep-lead">✎ {reviewCount} task{reviewCount === 1 ? '' : 's'} never reviewed</span>
      <span class="sweep-cta">sweep →</span>
    </button>
  {/if}

  <section class="lists">
    {#each grouped as [group, lists] (group)}
      {#if group !== ''}
        <h2 class="group-header" class:drop-target={dragId !== null && dragOverGroup === group}
          data-group-start={group}>{group}</h2>
      {:else}
        <div class="group-anchor" data-group-start=""></div>
      {/if}
      {#each shownLists(group, lists) as l (l.id)}
        <div class="list-row" class:lifted={dragId === l.id}
          animate:flip={{ duration: rowFlipMs }}
          data-list-row={l.id} data-list-group={group} data-testid="list-row-{l.id}">
          <button class="list-grip" data-testid="list-drag-{l.id}" aria-label="drag to reorder"
            onpointerdown={(e) => startListDrag(e, group, l.id)}>
            <Glyph name="grip" size={12} />
          </button>
          <button class="list-main" onclick={() => navigate({ name: 'list', id: l.id })}>
            <span class="prompt" aria-hidden="true">&gt;</span>
            <span class="list-title">{l.title}</span>
            {#if l.deadline}
              {@const tier = projectTiers.get(l.id)}
              <span class="project {tier ?? 'low'}" title="project deadline {l.deadline}">
                ▤ {l.deadline.slice(5)}
              </span>
            {/if}
            {#if describeWindow(l)}
              <span class="window" class:asleep={!isListActiveAt(l, new Date())}
                title="the randomizer draws from this list {describeWindow(l)}{l.urgentOverridesHours ? ' — MAX-priority tasks get through any time' : ''}">
                <Glyph name={isListActiveAt(l, new Date()) ? 'dice' : 'moon'} size={10} /> {describeWindow(l)}{#if l.urgentOverridesHours}<Glyph name="bolt" size={10} />{/if}
              </span>
            {/if}
            <span class="load" aria-hidden="true">
              <span class="load-fill" style="width: {loadShare(l.id)}%"></span>
            </span>
            <span class="count">{countFor(l.id)}</span>
          </button>
          <button class="menu-btn" data-testid="list-menu-{l.id}"
            onclick={() => (settingsForId = l.id)} aria-label="list settings">⋯</button>
        </div>
      {/each}
    {/each}

    {#if newListOpen}
      <input class="inline-edit new-list-input" data-testid="new-list-input"
        bind:this={newListInput} bind:value={newListTitle} placeholder="list name"
        onblur={createList}
        onkeydown={(e) => { if (e.key === 'Enter') createList(); if (e.key === 'Escape') { newListOpen = false; newListTitle = ''; } }} />
    {:else}
      <button class="new-list" data-testid="new-list" onclick={() => (newListOpen = true)}>+ new list</button>
    {/if}
  </section>

  <div class="footer-links">
    <button data-testid="inprogress-link" onclick={() => navigate({ name: 'inprogress' })}>
      <span class="ico"><Glyph name="play" size={15} /></span> In Progress{#if inProgressCount > 0}&nbsp;({inProgressCount}){/if}
    </button>
    {#if ritualCount > 0}
      <button data-testid="rituals-link" onclick={() => navigate({ name: 'rituals' })}>
        <span class="ico"><Glyph name="period" size={15} /></span> Rituals{#if ritualsDue > 0}&nbsp;<span class="due-count">({ritualsDue} due)</span>{/if}
      </button>
    {/if}
    <button data-testid="recurring-link" onclick={() => navigate({ name: 'recurring' })}>
      <span class="ico">↻</span> Recurring{#if recurringCount > 0}&nbsp;({recurringCount}){/if}
    </button>
    <button data-testid="completed-link" onclick={() => navigate({ name: 'completed' })}>
      <span class="ico">✓</span> Completed
    </button>
    <button data-testid="settings-link" onclick={() => navigate({ name: 'settings' })}>
      <span class="ico"><Glyph name="settings" size={15} /></span> Settings{#if app.syncStatus === 'error' || app.syncStatus === 'offline'}&nbsp;<span class="sync-warn">●</span>{/if}
    </button>
  </div>
</main>
{#if quickAddOpen}
  <QuickAdd onclose={() => (quickAddOpen = false)} />
{/if}
{#if settingsFor}
  <ListSettings list={settingsFor} onclose={() => (settingsForId = null)} />
{/if}
<Companion />

<style>
  /* Inline glyphs sit on the text baseline row rather than below it. */
  .window, .footer-links button { display: inline-flex; align-items: center; gap: 5px; }

  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  .wordmark { font-family: var(--font-mono); font-size: 1.5rem; margin: 0; font-weight: 600; }
  .accent { color: var(--acc-purple); }
  .cursor { color: var(--acc-green); animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .tagline { color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; margin: 4px 0 20px; }

  .capture-row { display: flex; gap: 8px; margin-bottom: 10px; }
  .quick-add {
    flex: none; background: var(--bg1); border: 1px solid var(--acc-green); border-radius: 8px;
    color: var(--acc-green); font-family: var(--font-mono); font-size: 0.8rem; font-weight: 700;
    padding: 0 14px; cursor: pointer; white-space: nowrap;
  }
  .quick-add:hover { background: var(--acc-green); color: var(--bg0); }
  .search-bar {
    flex: 1; display: flex; align-items: center; gap: 8px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--dim); font-size: 0.85rem; padding: 10px 12px; cursor: text; text-align: left;
  }
  .search-bar:hover { border-color: var(--acc-blue); color: var(--text); }
  .mag { font-size: 1.45rem; color: var(--acc-blue); line-height: 1; }
  .sort-row { display: flex; gap: 8px; margin-bottom: 20px; }
  .sort-row button {
    flex: 1; background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--acc-blue); font-family: var(--font-mono); font-size: 0.8rem;
    padding: 8px 0; cursor: pointer;
  }
  .sort-row button:hover { background: var(--bg2); }

  .lists { display: flex; flex-direction: column; gap: 6px; }
  .group-header {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 14px 0 2px; font-weight: 600;
  }
  .list-grip {
    flex: none; align-self: center; background: none; border: none;
    color: var(--line); cursor: grab; padding: 8px 4px;
    /* The drag must never turn into a page scroll — same as the task rows. */
    touch-action: none;
  }
  .list-grip:hover { color: var(--dim); }
  .list-grip:active { cursor: grabbing; }
  /*
    The dragged row stays fully visible and looks lifted; the gap it leaves is
    made by its neighbours sliding, which is what tells you where it will land.
  */
  .list-row.lifted {
    border-color: var(--acc-green);
    box-shadow: 0 6px 18px rgb(0 0 0 / 0.45);
    transform: scale(1.02);
    position: relative; z-index: 2;
  }
  .group-header.drop-target { color: var(--acc-green); }
  .group-anchor { height: 0; }
  .list-row { position: relative; display: flex; align-items: stretch; }
  .list-main {
    flex: 1; display: flex; justify-content: space-between; align-items: center;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); padding: 14px; font-size: 0.95rem; cursor: pointer; text-align: left;
  }
  .list-main:hover { background: var(--bg2); }
  .list-title { font-weight: 500; }
  .prompt {
    color: var(--acc-green); font-family: var(--font-mono); font-weight: 700;
    margin-right: 2px; opacity: 0.75; flex: none;
  }
  .list-row:hover .prompt { opacity: 1; }
  /* Sits right of the title, left of the count: a glance tells you which lists
     are carrying the weight without reading a single number. */
  .load {
    margin-left: auto; margin-right: 8px; width: 46px; height: 3px; flex: none;
    background: var(--bg2); border-radius: 2px; overflow: hidden;
  }
  .load-fill { display: block; height: 100%; background: var(--acc-green); opacity: 0.55; }
  .count { color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; }
  .window {
    margin-right: 10px;
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.65rem;
  }
  .window.asleep { color: var(--dim); }
  .project {
    margin-left: auto; margin-right: 8px;
    font-family: var(--font-mono); font-size: 0.65rem; color: var(--dim);
  }
  .project.medium { color: var(--acc-green); }
  .project.high { color: var(--acc-orange); }
  .project.max { color: var(--acc-magenta); font-weight: 700; }
  .menu-btn {
    background: none; border: none; color: var(--dim); font-size: 1.1rem;
    cursor: pointer; padding: 0 10px;
  }
  .menu-btn:hover { color: var(--text); }
  .inline-edit {
    flex: 1; background: var(--bg2); border: 1px solid var(--acc-blue); border-radius: 8px;
    color: var(--text); padding: 14px; font-size: 0.95rem; outline: none;
  }
  .new-list {
    margin-top: 10px; /* not another row in the list — a different kind of thing */
    background: none; border: 1px dashed var(--line); border-radius: 8px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem;
    padding: 12px; cursor: pointer; text-align: left;
  }
  .new-list:hover { color: var(--acc-green); border-color: var(--acc-green); }

  .big-button {
    width: 100%; margin-bottom: 20px; padding: 22px 12px;
    background: linear-gradient(135deg, var(--bg2), var(--bg1));
    border: 1px solid var(--acc-purple); border-radius: 14px;
    color: var(--acc-purple); font-family: var(--font-mono);
    font-size: 1.15rem; font-weight: 700; cursor: pointer;
    transition: transform 0.1s ease, box-shadow 0.15s ease;
  }
  .big-button:hover { transform: scale(1.015); box-shadow: 0 0 24px rgba(210, 168, 255, 0.25); }
  .big-button:active { transform: scale(0.985); }
  @media (prefers-reduced-motion: no-preference) {
    .big-button { position: relative; overflow: hidden; }
    .big-button::after {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(105deg, transparent 38%,
        rgba(121, 192, 255, 0.10) 45%, rgba(210, 168, 255, 0.28) 50%,
        rgba(126, 231, 135, 0.10) 55%, transparent 62%);
      transform: translateX(-130%);
      animation: big-shimmer 7s ease-in-out infinite 2s;
    }
    @keyframes big-shimmer {
      0% { transform: translateX(-130%); }
      13% { transform: translateX(130%); }
      100% { transform: translateX(130%); }
    }
  }

  .footer-links { margin-top: 24px; display: flex; flex-direction: column; }
  .footer-links button {
    width: 100%; background: none; border: none;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.95rem;
    padding: 12px 10px; cursor: pointer; text-align: left;
  }
  .footer-links button:hover { color: var(--acc-green); }
  .due-count { color: var(--acc-magenta); }
  .sweep-banner {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    width: 100%; margin-bottom: 14px;
    background: var(--bg1); border: 1px dashed var(--acc-yellow); border-radius: 10px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.78rem;
    padding: 11px 14px; cursor: pointer;
  }
  .sweep-banner:hover { border-style: solid; }
  .sweep-lead { color: var(--acc-yellow); }
  .sweep-cta { color: var(--dim); }
  .sweep-banner:hover .sweep-cta { color: var(--acc-yellow); }
  /* One column for the icon whatever it is — drawn glyph or typographic mark —
     so the four labels start on the same pixel. */
  .ico {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; flex: none; font-size: 0.95rem; line-height: 1;
  }
  .sync-warn { color: var(--acc-orange); }
</style>
