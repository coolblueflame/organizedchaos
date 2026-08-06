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
  import { withoutLocked } from '../domain/lock';
  import { lock } from './lock.svelte';
  import { projectPriorities } from '../domain/project';
  import { moveAcross, moveWithin, sameGrouping, sortLists, type GroupedIds } from '../domain/listOrder';
  import { isRitualDue, isRitualTask } from '../domain/ritual';
  import { clock } from './clock.svelte';
  import { createDragScroller } from './dragScroll';
  import { primeKeyboard } from './keyboardBridge';
  import { searchQuery } from './searchState.svelte';
  import ListSettings from './ListSettings.svelte';
  import { flip } from 'svelte/animate';
  import { motionOk } from './fx/particles';
  import type { List, Task } from '../domain/types';
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

  /** The roll-next card skips the accept screen (2026-08-01 ask): the big
      button is right there for browsing — this one commits. An empty pool
      falls through to the randomizer so its empty state can explain itself. */
  async function rollStraightIn() {
    haptic('tick');
    if (!(await app.rollStraightIn())) navigate({ name: 'randomizer' });
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
    app.state.tasks.filter((t) => !t.deleted && isRitualTask(t)).length,
  );
  const reviewCount = $derived(app.tasksNeedingReview().length);
  const archivedLists = $derived(app.state.lists.filter((l) => l.archived === true));
  /*
    The dice's own lists: a trailing group that EXISTS only while it holds open
    work. Completing the last generated task makes the whole section vanish —
    a vessel, not a commitment, and never something to feel behind on.
  */
  const generatedLists = $derived(
    app.state.lists.filter((l) =>
      l.generated === true && l.archived !== true &&
      open.some((t) => t.listId === l.id)),
  );
  const ritualsDue = $derived(
    app.state.tasks.filter((t) =>
      !t.deleted && isRitualDue(t, clock.now, app.state.settings.rolloverHour)).length,
  );

  /** Lists bucketed by areaGroup: ungrouped first, then groups alphabetically. */
  const grouped = $derived.by(() => {
    const buckets = new Map<string, List[]>();
    for (const l of app.state.lists.filter((x) => x.archived !== true && x.generated !== true)) {
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

  /**
   * The finger that owns the current drag. svelte:window handlers hear EVERY
   * pointer, so without this a second finger resting on the screen would both
   * yank the hit-test to its own Y and commit the drag on ITS pointerup.
   */
  let dragPointerId: number | null = null;

  function startListDrag(e: PointerEvent, group: string, id: string) {
    e.preventDefault();
    dragPointerId = e.pointerId;
    dragId = id;
    dragStartGroup = group;
    dragOverGroup = group;
    dragGroups = new Map(grouped.map(([g, lists]) => [g, lists.map((l) => l.id)]));
  }

  let listPointerY = 0;

  /** Shared by pointermove and the auto-scroller's frames. */
  function listHitTest() {
    if (!dragId || !dragGroups) return;

    // Which group is the finger in? The heading directly above it wins, so
    // dragging past a heading moves the list into that section.
    let group = grouped[0]?.[0] ?? '';
    for (const el of document.querySelectorAll<HTMLElement>('[data-group-start]')) {
      if (listPointerY >= el.getBoundingClientRect().top) group = el.dataset.groupStart!;
    }

    // And where among that group's rows? Compare against each row's midpoint so
    // the list opens up as soon as the finger passes half way, rather than
    // waiting until it is fully over the next row.
    const rows = [...document.querySelectorAll<HTMLElement>('[data-list-row]')]
      .filter((el) => el.dataset.listGroup === group && el.dataset.listRow !== dragId);
    let index = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const box = rows[i]!.getBoundingClientRect();
      if (listPointerY < box.top + box.height / 2) { index = i; break; }
    }

    const next = moveAcross(dragGroups, dragId, group, index);
    dragOverGroup = group;
    if (!sameGrouping(next, dragGroups)) {
      dragGroups = next;
      haptic('tick');
    }
  }

  const listScroller = createDragScroller(listHitTest);

  function onListDragMove(e: PointerEvent) {
    if (!dragId || !dragGroups || e.pointerId !== dragPointerId) return;
    listPointerY = e.clientY;
    listHitTest();
    listScroller.update(e.clientY);
  }

  async function endListDrag() {
    listScroller.stop();
    // Commit what the finger last saw — the flip animation moves rects under
    // the pointer, so the last MOVE's hit-test can be one slot stale (the
    // same lesson the queue and custom-sort drags already carry).
    listHitTest();
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

  // ── the day queue (2026-07-29 request) ─────────────────────────────────
  const queueTasks = $derived(app.queuedTasks());
  const listTitle = (id: string) => app.state.lists.find((l) => l.id === id)?.title ?? '';

  /** Same grip-drag contract as the list rows, over a single flat order. */
  let queueDragId = $state<string | null>(null);
  let queueOrder = $state<string[] | null>(null);
  let queuePointerY = 0;

  function startQueueDrag(e: PointerEvent, id: string) {
    e.preventDefault();
    dragPointerId = e.pointerId;
    queueDragId = id;
    queueOrder = queueTasks.map((t) => t.id);
  }

  function queueHitTest() {
    if (!queueDragId || !queueOrder) return;
    const rows = [...document.querySelectorAll<HTMLElement>('[data-queue-row]')]
      .filter((el) => el.dataset.queueRow !== queueDragId);
    let index = rows.length;
    for (let i = 0; i < rows.length; i += 1) {
      const box = rows[i]!.getBoundingClientRect();
      if (queuePointerY < box.top + box.height / 2) { index = i; break; }
    }
    const next = moveWithin(queueOrder, queueDragId, index);
    if (next.join('\n') !== queueOrder.join('\n')) {
      queueOrder = next;
      haptic('tick');
    }
  }

  const queueScroller = createDragScroller(queueHitTest);

  function onQueueDragMove(e: PointerEvent) {
    if (!queueDragId || !queueOrder || e.pointerId !== dragPointerId) return;
    queuePointerY = e.clientY;
    queueHitTest();
    queueScroller.update(e.clientY);
  }

  async function endQueueDrag() {
    if (!queueDragId) return;
    queueScroller.stop();
    // Commit what the finger last saw — rects can shift under a flip mid-drag.
    queueHitTest();
    const order = queueOrder;
    queueDragId = null;
    queueOrder = null;
    if (order) await app.reorderQueue(order);
  }

  /** The rows to render: the live drag order while a drag is in flight.
      Locked lists' tasks stay QUEUED but don't render their names while the
      app is locked — the queue is the home screen's most readable surface. */
  const shownQueue = $derived.by(() => {
    const visible = withoutLocked(queueTasks, app.state.lists, lock.unlocked);
    if (!queueOrder) return visible;
    const byId = new Map(visible.map((t) => [t.id, t]));
    return queueOrder.map((id) => byId.get(id)).filter((t): t is Task => t !== undefined);
  });

  /** Cancelled gestures reset everything without writing anything. */
  function abortDrags() {
    listScroller.stop();
    queueScroller.stop();
    dragId = null;
    dragGroups = null;
    dragOverGroup = null;
    dragStartGroup = null;
    queueDragId = null;
    queueOrder = null;
  }

  // Leaving the screen mid-drag must stop the auto-scroll rAF loop — it has
  // no idea the component is gone and would keep scrolling the next screen.
  $effect(() => () => abortDrags());

  let clearArmed = $state(false);
  let clearTimer: ReturnType<typeof setTimeout> | undefined;
  function clearQueueTap() {
    if (!clearArmed) {
      clearArmed = true;
      clearTimer = setTimeout(() => (clearArmed = false), 3000);
      return;
    }
    clearTimeout(clearTimer);
    clearArmed = false;
    void app.clearQueue();
  }

  async function createList() {
    const title = newListTitle.trim();
    if (!title) { newListOpen = false; return; }
    // New lists file under "Unsorted" (2026-08-05 ask) rather than the
    // ungrouped bucket at the TOP — the input sits at the bottom of the
    // screen, and the list should land where the typing happened, not
    // teleport above everything the user has deliberately arranged.
    // Filing it properly later is one drag, same as ever.
    const list = await app.addList(title, 'Unsorted');
    newListTitle = '';
    newListOpen = false;
    navigate({ name: 'list', id: list.id });
  }

  const projectTiers = $derived(
    projectPriorities(app.state.lists, app.state.tasks, app.state.settings, clock.now),
  );

  $effect(() => {
    if (newListOpen) newListInput?.focus();
  });
</script>

<svelte:window
  onpointermove={(e) => { onListDragMove(e); onQueueDragMove(e); }}
  onpointerup={(e) => {
    if (e.pointerId !== dragPointerId) return;
    dragPointerId = null;
    void endListDrag();
    void endQueueDrag();
  }}
  onpointercancel={(e) => {
    // The system stole the gesture (edge swipe, notification shade, a call):
    // ABORT, never commit — a later unrelated tap must not inherit half a
    // reorder, and the auto-scroller must not keep rolling with no finger.
    if (e.pointerId !== dragPointerId) return;
    dragPointerId = null;
    abortDrags();
  }} />

<main>
  <h1 class="wordmark" onpointerdown={wordmarkTap}>organized<span class="accent">chaos</span><span class="cursor">▊</span></h1>
  <p class="tagline">// a todo list with loaded dice</p>

  <InstallBanner />

  <StatsStrip />

  <CurrentTaskCard onroll={() => void rollStraightIn()} />

  <WorkPeriod />

  <button class="big-button" data-testid="big-button" onclick={bigButton}>
    {phrase}
  </button>

  <div class="capture-row">
    <button class="search-bar" data-testid="search-entry"
      onclick={() => { searchQuery.beginFresh(); primeKeyboard(); navigate({ name: 'search' }); }}>
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
            {#if l.locked}<span class="locked-mark" title={lock.unlocked ? 'locked list — open this session' : 'locked — PIN needed to open'}
              class:open={lock.unlocked}><Glyph name="locked" size={10} /></span>{/if}
            {#if l.deadline}
              {@const tier = projectTiers.get(l.id)}
              <span class="project {tier ?? 'low'}" title="project deadline {l.deadline}">
                ▤ {l.deadline.slice(5)}
              </span>
            {/if}
            {#if describeWindow(l)}
              <span class="window" class:asleep={!isListActiveAt(l, clock.now)}
                title="the randomizer draws from this list {describeWindow(l)}{l.urgentOverridesHours ? ' — MAX-priority tasks get through any time' : ''}">
                <!-- Symbol only (2026-08-01 ask): the full window text cluttered
                     rows once most lists had hours. Detail lives in the title
                     tooltip and the list's settings sheet. -->
                <Glyph name={isListActiveAt(l, clock.now) ? 'dice' : 'moon'} size={10} />{#if l.urgentOverridesHours}<Glyph name="bolt" size={10} />{/if}
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

    {#if generatedLists.length > 0}
      <h2 class="group-header gen" data-testid="generated-header">summoned by the dice</h2>
      {#each generatedLists as l (l.id)}
        <div class="list-row gen" data-testid="list-row-{l.id}">
          <button class="list-main" onclick={() => navigate({ name: 'list', id: l.id })}>
            <span class="prompt gen-prompt" aria-hidden="true">✦</span>
            <span class="list-title">{l.title}</span>
            <span class="load" aria-hidden="true">
              <span class="load-fill" style="width: {loadShare(l.id)}%"></span>
            </span>
            <span class="count">{countFor(l.id)}</span>
          </button>
        </div>
      {/each}
    {/if}

    {#if newListOpen}
      <!-- The header cue says where this will file — the group the list
           lands in the moment the name is committed. Once a real Unsorted
           section exists its own header is the cue, so no duplicate. -->
      {#if !grouped.some(([g]) => g === 'Unsorted')}
        <h2 class="group-header" data-testid="new-list-destined">Unsorted</h2>
      {/if}
      <input class="inline-edit new-list-input" data-testid="new-list-input"
        bind:this={newListInput} bind:value={newListTitle} placeholder="list name"
        onblur={createList}
        onkeydown={(e) => { if (e.key === 'Enter') createList(); if (e.key === 'Escape') { newListOpen = false; newListTitle = ''; } }} />
    {:else}
      <button class="new-list" data-testid="new-list" onclick={() => (newListOpen = true)}>+ new list</button>
    {/if}
  </section>

  {#if archivedLists.length > 0}
    <details class="shelf" data-testid="archived-shelf">
      <summary>archived · {archivedLists.length}</summary>
      {#each archivedLists as l (l.id)}
        <div class="shelf-row" data-testid="archived-row-{l.id}">
          <button class="shelf-title" onclick={() => navigate({ name: 'list', id: l.id })}>{l.title}</button>
          <button class="shelf-revive" data-testid="unarchive-{l.id}"
            onclick={() => void app.setListArchived(l.id, false)}>revive</button>
        </div>
      {/each}
    </details>
  {/if}

  {#if shownQueue.length > 0}
    <section class="queue" data-testid="queue-section">
      <div class="q-head">
        <h2 class="group-header q-title">≡ today's queue · {shownQueue.length}</h2>
        <button class="q-clear" class:armed={clearArmed} data-testid="queue-clear" onclick={clearQueueTap}>
          {clearArmed ? 'tap again to clear' : 'clear'}
        </button>
      </div>
      <!-- Budgeted like every per-task surface: a multi-select can queue
           hundreds in one gesture, and home must not mount them all. -->
      {#each shownQueue.slice(0, 80) as t, i (t.id)}
        <div class="q-row" class:lifted={queueDragId === t.id}
          data-queue-row={t.id} data-testid="queue-row-{t.id}"
          animate:flip={{ duration: queueDragId ? rowFlipMs : 0 }}>
          <button class="list-grip" data-testid="queue-drag-{t.id}" aria-label="drag to reorder"
            onpointerdown={(e) => startQueueDrag(e, t.id)}>
            <Glyph name="grip" size={12} />
          </button>
          <span class="q-pos">{i + 1}</span>
          <button class="q-check" data-testid="queue-check-{t.id}" aria-label="mark done"
            onclick={() => void app.completeTask(t.id)}><Glyph name="box" size={15} /></button>
          <button class="q-main" onclick={() => navigate({ name: 'list', id: t.listId })}>
            <span class="q-name">{t.name || 'untitled'}</span>
            <span class="q-list">{listTitle(t.listId)}</span>
          </button>
          <button class="q-remove" data-testid="queue-remove-{t.id}" aria-label="remove from queue"
            onclick={() => void app.removeFromQueue(t.id)}><span aria-hidden="true">✕</span></button>
        </div>
      {/each}
      {#if shownQueue.length > 80}
        <p class="q-more">…and {shownQueue.length - 80} more queued</p>
      {/if}
    </section>
  {/if}

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
      <span class="ico ico-text">↻</span> Recurring{#if recurringCount > 0}&nbsp;({recurringCount}){/if}
    </button>
    <button data-testid="completed-link" onclick={() => navigate({ name: 'completed' })}>
      <span class="ico ico-text">✓</span> Completed
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
  @media (hover: hover) { .quick-add:hover { background: var(--acc-green); color: var(--bg0); } }
  .search-bar {
    flex: 1; display: flex; align-items: center; gap: 8px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--dim); font-size: 0.85rem; padding: 10px 12px; cursor: text; text-align: left;
  }
  @media (hover: hover) { .search-bar:hover { border-color: var(--acc-blue); color: var(--text); } }
  .mag { font-size: 1.45rem; color: var(--acc-blue); line-height: 1; }
  .sort-row { display: flex; gap: 8px; margin-bottom: 20px; }
  .sort-row button {
    flex: 1; background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--acc-blue); font-family: var(--font-mono); font-size: 0.8rem;
    padding: 8px 0; cursor: pointer;
  }
  @media (hover: hover) { .sort-row button:hover { background: var(--bg2); } }

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
  @media (hover: hover) { .list-grip:hover { color: var(--dim); } }
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
  .group-header.gen { color: var(--acc-purple); font-style: italic; margin-top: 18px; }
  .list-row.gen { border-style: dashed; border-color: color-mix(in srgb, var(--acc-purple) 45%, var(--line)); }
  .gen-prompt { color: var(--acc-purple); }
  .list-row { position: relative; display: flex; align-items: stretch; }
  .list-main {
    flex: 1; display: flex; justify-content: space-between; align-items: center;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); padding: 14px; font-size: 0.95rem; cursor: pointer; text-align: left;
  }
  @media (hover: hover) { .list-main:hover { background: var(--bg2); } }
  .list-title { font-weight: 500; }
  .prompt {
    color: var(--acc-green); font-family: var(--font-mono); font-weight: 700;
    margin-right: 6px; opacity: 0.75; flex: none;
  }
  @media (hover: hover) { .list-row:hover .prompt { opacity: 1; } }
  /* Sits right of the title, left of the count: a glance tells you which lists
     are carrying the weight without reading a single number. */
  .load {
    margin-left: auto; margin-right: 8px; width: 46px; height: 3px; flex: none;
    background: var(--bg2); border-radius: 2px; overflow: hidden;
  }
  .load-fill { display: block; height: 100%; background: var(--acc-green); opacity: 0.55; }
  .count { color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; }
  .locked-mark { color: var(--acc-yellow); flex: none; display: inline-flex; margin-left: 8px; }
  .locked-mark.open { color: var(--dim); opacity: 0.6; }
  .window {
    /* Breathing room on the left (2026-08-01 night ask): symbol-only marks
       sat flush against the title and read as part of the list's name. */
    margin-left: 8px; margin-right: 10px;
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
  @media (hover: hover) { .menu-btn:hover { color: var(--text); } }
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
  @media (hover: hover) { .new-list:hover { color: var(--acc-green); border-color: var(--acc-green); } }

  .big-button {
    width: 100%; margin-bottom: 20px; padding: 22px 12px;
    background: linear-gradient(135deg, var(--bg2), var(--bg1));
    border: 1px solid var(--acc-purple); border-radius: 14px;
    color: var(--acc-purple); font-family: var(--font-mono);
    font-size: 1.15rem; font-weight: 700; cursor: pointer;
    transition: transform 0.1s ease, box-shadow 0.15s ease;
  }
  @media (hover: hover) { .big-button:hover { transform: scale(1.015); box-shadow: 0 0 24px rgba(210, 168, 255, 0.25); } }
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
  @media (hover: hover) { .footer-links button:hover { color: var(--acc-green); } }
  .due-count { color: var(--acc-magenta); }
  .shelf { margin-top: 18px; }
  .shelf summary {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    cursor: pointer; padding: 6px 2px; list-style: none;
  }
  .shelf summary::before { content: '▸ '; }
  .shelf[open] summary::before { content: '▾ '; }
  @media (hover: hover) { .shelf summary:hover { color: var(--text); } }
  .shelf-row { display: flex; align-items: center; gap: 8px; padding: 5px 2px 5px 14px; }
  .shelf-title {
    flex: 1; min-width: 0; text-align: left; background: none; border: none; padding: 0;
    color: var(--dim); font-size: 0.85rem; cursor: pointer;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  @media (hover: hover) { .shelf-title:hover { color: var(--text); } }
  .shelf-revive {
    background: none; border: none; color: var(--acc-blue); cursor: pointer;
    font-family: var(--font-mono); font-size: 0.7rem; text-decoration: underline; padding: 2px;
  }
  .sweep-banner {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    width: 100%; margin-bottom: 14px;
    background: var(--bg1); border: 1px dashed var(--acc-yellow); border-radius: 10px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.78rem;
    padding: 11px 14px; cursor: pointer;
  }
  @media (hover: hover) { .sweep-banner:hover { border-style: solid; } }
  .sweep-lead { color: var(--acc-yellow); }
  .sweep-cta { color: var(--dim); }
  @media (hover: hover) { .sweep-banner:hover .sweep-cta { color: var(--acc-yellow); } }
  /* One column for the icon whatever it is — drawn glyph or typographic mark —
     so the four labels start on the same pixel. */
  .ico {
    display: inline-flex; align-items: center; justify-content: center;
    width: 18px; flex: none; font-size: 0.95rem; line-height: 1;
  }
  /* Typographic marks fill less of their em box than a drawn 15px glyph fills
     its viewBox — same nominal size reads smaller. Compensate. */
  .ico-text { font-size: 1.2rem; }
  .sync-warn { color: var(--acc-orange); }
  /* ── the day queue ── */
  .queue { margin-top: 18px; }
  .q-head { display: flex; align-items: baseline; justify-content: space-between; }
  .group-header.q-title { color: var(--acc-cyan); }
  .q-clear {
    background: none; border: none; color: var(--dim); cursor: pointer;
    font-family: var(--font-mono); font-size: 0.7rem; padding: 2px 4px;
  }
  @media (hover: hover) { .q-clear:hover { color: var(--text); } }
  .q-clear.armed { color: var(--acc-magenta); }
  .q-row {
    display: flex; align-items: center; gap: 6px; margin-bottom: 4px;
    background: var(--bg1); border: 1px solid color-mix(in srgb, var(--acc-cyan) 25%, var(--line));
    border-radius: 8px; padding: 6px 8px 6px 2px;
  }
  .q-row.lifted {
    border-color: var(--acc-cyan);
    box-shadow: 0 4px 14px rgb(0 0 0 / 0.45);
  }
  .q-pos {
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.7rem;
    min-width: 16px; text-align: right; flex: none;
  }
  .q-check {
    background: none; border: none; color: var(--dim); cursor: pointer;
    display: flex; align-items: center; padding: 4px; flex: none;
  }
  @media (hover: hover) { .q-check:hover { color: var(--acc-green); } }
  .q-main {
    flex: 1; min-width: 0; display: flex; align-items: baseline; gap: 8px;
    background: none; border: none; color: var(--text); cursor: pointer;
    text-align: left; padding: 4px 0; font-size: 0.9rem;
  }
  .q-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .q-list {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.65rem;
    flex: none; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 28vw;
  }
  .q-remove {
    background: none; border: none; color: var(--dim); cursor: pointer;
    padding: 4px 6px; flex: none; font-size: 0.8rem;
  }
  .q-more { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; margin: 2px 0 0 26px; }
  @media (hover: hover) { .q-remove:hover { color: var(--acc-magenta); } }
</style>
