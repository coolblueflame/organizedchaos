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
  import { moveWithin, sortLists } from '../domain/listOrder';
  import ListSettings from './ListSettings.svelte';
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
  const recurringCount = $derived(app.state.templates.filter((t) => !t.deleted).length);

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
  let dragId = $state<string | null>(null);
  /** Live sequence while dragging, so the list reflows under your finger. */
  let dragOrder = $state<string[] | null>(null);
  let dragGroup: string | null = null;

  function startListDrag(e: PointerEvent, group: string, ids: string[], id: string) {
    e.preventDefault();
    dragId = id;
    dragGroup = group;
    dragOrder = [...ids];
  }

  function onListDragMove(e: PointerEvent) {
    if (!dragId || !dragOrder) return;
    // Where does the pointer sit relative to the rows currently on screen?
    const rows = [...document.querySelectorAll<HTMLElement>('[data-list-row]')]
      .filter((el) => dragOrder!.includes(el.dataset.listRow!));
    let target = dragOrder.indexOf(dragId);
    rows.forEach((el, i) => {
      const box = el.getBoundingClientRect();
      if (e.clientY > box.top && e.clientY < box.bottom) target = i;
    });
    const next = moveWithin(dragOrder, dragId, target);
    if (next.join() !== dragOrder.join()) {
      dragOrder = next;
      haptic('tick');
    }
  }

  async function endListDrag() {
    const ids = dragOrder;
    const moved = dragId !== null;
    dragId = null;
    dragOrder = null;
    dragGroup = null;
    if (moved && ids) await app.reorderLists(ids);
  }

  /** The sequence to render for a group: the live drag order if it owns one. */
  const shownLists = (group: string, lists: List[]): List[] => {
    if (dragGroup !== group || !dragOrder) return lists;
    const byId = new Map(lists.map((l) => [l.id, l]));
    return dragOrder.map((id) => byId.get(id)).filter((l): l is List => l !== undefined);
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

  <section class="lists">
    {#each grouped as [group, lists] (group)}
      {#if group !== ''}
        <h2 class="group-header">{group}</h2>
      {/if}
      {@const ids = shownLists(group, lists).map((x) => x.id)}
      {#each shownLists(group, lists) as l (l.id)}
        <div class="list-row" class:lifted={dragId === l.id}
          data-list-row={l.id} data-testid="list-row-{l.id}">
          <button class="list-grip" data-testid="list-drag-{l.id}" aria-label="drag to reorder"
            onpointerdown={(e) => startListDrag(e, group, ids, l.id)}>
            <Glyph name="grip" size={12} />
          </button>
          <button class="list-main" onclick={() => navigate({ name: 'list', id: l.id })}>
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
      <Glyph name="play" size={10} /> In Progress{#if inProgressCount > 0}&nbsp;({inProgressCount}){/if}
    </button>
    <button data-testid="recurring-link" onclick={() => navigate({ name: 'recurring' })}>
      ↻ Recurring{#if recurringCount > 0}&nbsp;({recurringCount}){/if}
    </button>
    <button data-testid="completed-link" onclick={() => navigate({ name: 'completed' })}>
      ✓ Completed
    </button>
    <button data-testid="settings-link" onclick={() => navigate({ name: 'settings' })}>
      <Glyph name="settings" size={11} /> Settings{#if app.syncStatus === 'error' || app.syncStatus === 'offline'}&nbsp;<span class="sync-warn">●</span>{/if}
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
  .mag { font-size: 1.1rem; color: var(--acc-blue); }
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
  .list-row.lifted { opacity: 0.5; }
  .list-row { position: relative; display: flex; align-items: stretch; }
  .list-main {
    flex: 1; display: flex; justify-content: space-between; align-items: center;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); padding: 14px; font-size: 0.95rem; cursor: pointer; text-align: left;
  }
  .list-main:hover { background: var(--bg2); }
  .list-title { font-weight: 500; }
  .count { color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; }
  .window {
    margin-left: auto; margin-right: 10px;
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
    color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem;
    padding: 10px; cursor: pointer; text-align: left;
  }
  .footer-links button:hover { color: var(--acc-green); }
  .sync-warn { color: var(--acc-orange); }
</style>
