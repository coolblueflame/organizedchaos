<!--
  Shared grouped-task body for the list and sort views: group headers, rows,
  within-group sub-sorting, and drag-to-regroup (drop a task on a header to
  adopt that group's priority / tag / deadline).

  Uses pointer events rather than HTML5 drag-and-drop, which iOS Safari does
  not support for touch — this way the same code works on phone and desktop.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import type { TaskGroup } from '../domain/views';
  import { regroupPatch } from '../domain/regroup';
  import { PRIORITIES, type Priority, type Task } from '../domain/types';
  import TaskRow from './TaskRow.svelte';
  import { haptic } from './fx/haptics';
  import { burstAt, motionOk } from './fx/particles';
  import Glyph from './Glyph.svelte';
  import { revealOnApproach } from './lazyReveal';
  import { createDragScroller } from './dragScroll';
  import { moveWithin } from '../domain/listOrder';
  import { flip } from 'svelte/animate';
  import { motionOk as motionOkFlip } from './fx/particles';

  let {
    groups,
    mode,
    editingTaskId = $bindable(),
    showList = false,
    onenter,
  }: {
    groups: TaskGroup[];
    /** Which attribute a drop assigns; 'custom' makes dragging REORDER
     *  instead of regroup; null disables dragging. */
    mode: 'priority' | 'tag' | 'date' | 'custom' | null;
    editingTaskId: string | null;
    showList?: boolean;
    onenter?: (name: string) => void;
  } = $props();

  // ── multi-select ─────────────────────────────────────────────────────────
  let selected = $state<string[]>([]);
  /** Both start blank so picking the value you want always fires a change. */
  let bulkPriority = $state<Priority | ''>('');
  let bulkList = $state('');
  let bulkTag = $state('');
  let deleteArmed = $state(false);

  const selectionMode = $derived(selected.length > 0);

  // ── how many rows actually reach the DOM ─────────────────────────────────
  /*
    A sorted view of a real library is thousands of tasks, and every row is a
    live component — building them all is what made opening "by priority" stall
    for a beat before the screen appeared. So rows arrive a page at a time as
    you scroll down.

    The budget only ever grows. Resetting it when `groups` changes would be
    wrong: that happens on every edit, and it would haul you back to the top of
    a list you had scrolled halfway down. Leaving a view unmounts the component,
    which is what puts it back to one page.
  */
  const PAGE = 60;
  let budget = $state(PAGE);

  const total = $derived(groups.reduce((n, g) => n + g.tasks.length, 0));

  /** Groups trimmed to the budget, in order, each still knowing its full self. */
  const shown = $derived.by(() => {
    let left = budget;
    const out: Array<{ group: TaskGroup; tasks: Task[] }> = [];
    for (const group of groups) {
      if (left <= 0) break;
      out.push({ group, tasks: group.tasks.slice(0, left) });
      left -= Math.min(left, group.tasks.length);
    }
    return out;
  });
  const rendered = $derived(shown.reduce((n, g) => n + g.tasks.length, 0));



  function toggleSelect(id: string) {
    selected = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
  }

  function selectGroup(group: TaskGroup) {
    const ids = group.tasks.map((t) => t.id);
    const allIn = ids.every((id) => selected.includes(id));
    selected = allIn
      ? selected.filter((id) => !ids.includes(id))
      : [...new Set([...selected, ...ids])];
  }

  /**
   * Deleting a whole selection is the most destructive control in the app, so
   * it arms first — the same two-tap contract as single-task and list delete.
   */
  async function confirmDelete() {
    if (!deleteArmed) {
      deleteArmed = true;
      haptic('tick');
      setTimeout(() => (deleteArmed = false), 3000);
      return;
    }
    deleteArmed = false;
    await runBulk('delete');
  }

  async function runBulk(action: 'complete' | 'delete' | 'move' | 'priority' | 'tag', value?: string) {
    const ids = [...selected];
    selected = [];
    // Reset the pickers, or re-choosing the same value next time is a no-op.
    bulkPriority = '';
    bulkList = '';
    bulkTag = '';
    deleteArmed = false;
    await app.bulkApply(ids, action, value);
    haptic('success');
    // Scale the payoff to the size of the sweep — clearing eight at once should
    // feel like more than clearing one.
    if (ids.length >= 3 && action !== 'move' && motionOk()) {
      try {
        burstAt(window.innerWidth / 2, window.innerHeight * 0.75, {
          count: Math.min(12 + ids.length * 4, 60),
          power: 1 + Math.min(ids.length, 10) / 12,
        });
      } catch { /* fx never block the action */ }
    }
    // A big sweep earns its own moment; otherwise leave it to the ambient roll.
    if (ids.length < 5 || !app.grantUnlockAndShow('sweeper')) app.fireEgg('bulkActed');
  }

  const DRAG_THRESHOLD = 8; // px before a press becomes a drag, so taps still work

  let dragging = $state<Task | null>(null);
  let pointerY = $state(0);
  let pointerX = $state(0);
  let hoverKey = $state<string | null>(null);
  let origin: { x: number; y: number } | null = null;
  let candidate: Task | null = null;

  /**
   * A touch drag must start on the grip; a mouse drag can start anywhere.
   *
   * Dragging from anywhere was fine with a cursor and unusable with a finger:
   * a scroll is a press plus more than eight pixels of travel, which is exactly
   * the gesture this watches for, so trying to scroll a list dimmed the screen
   * and stuck a task under your thumb (reported 2026-07-28). The grip carries
   * `touch-action: none`, so a drag begun there never becomes a scroll, and
   * every other touch on the row is left to the browser.
   */
  function onPointerDown(e: PointerEvent, task: Task, fromGrip = false) {
    if (!mode || e.button !== 0) return;
    if (!fromGrip && e.pointerType !== 'mouse') return;
    if (fromGrip) e.preventDefault(); // no text selection or native drag image
    candidate = task;
    origin = { x: e.clientX, y: e.clientY };
  }

  /*
    Custom mode: dragging rearranges rather than regroups. The live sequence
    reflows under the finger (rows slide apart at each midpoint), exactly the
    feedback the home-screen list drag already has.
  */
  let customOrder = $state<string[] | null>(null);
  const rowFlipMs = motionOkFlip() ? 160 : 0;

  /** Re-runs on every pointermove AND every auto-scrolled frame: the page
   *  moves under a parked finger, so position alone goes stale. */
  function hitTest() {
    if (mode === 'custom') {
      if (!dragging) return;
      const base = customOrder ?? groups[0]?.tasks.map((t) => t.id) ?? [];
      const rows = [...document.querySelectorAll<HTMLElement>('[data-drag-row]')]
        .filter((el) => el.dataset.dragRow !== dragging!.id);
      let index = rows.length;
      for (let i = 0; i < rows.length; i += 1) {
        const box = rows[i]!.getBoundingClientRect();
        if (pointerY < box.top + box.height / 2) { index = i; break; }
      }
      const next = moveWithin(base, dragging.id, index);
      if (next.join() !== base.join()) {
        customOrder = next;
        haptic('tick');
      } else if (customOrder === null) {
        customOrder = base;
      }
      return;
    }
    const el = document.elementFromPoint(pointerX, pointerY);
    hoverKey = el?.closest<HTMLElement>('[data-group-key]')?.dataset.groupKey ?? null;
  }

  const scroller = createDragScroller(hitTest);

  function onPointerMove(e: PointerEvent) {
    if (!candidate || !origin) return;
    if (!dragging) {
      const far = Math.hypot(e.clientX - origin.x, e.clientY - origin.y);
      if (far < DRAG_THRESHOLD) return;
      dragging = candidate;
      haptic('tick');
    }
    pointerX = e.clientX;
    pointerY = e.clientY;
    hitTest();
    scroller.update(e.clientY);
  }

  /**
   * Everything the current drag is carrying. Dragging a row that is part of a
   * selection takes the whole selection with it — otherwise selecting a batch
   * and then dragging it silently moves one task and leaves the rest behind,
   * which reads as the drag having failed.
   */
  const dragPayload = $derived.by(() => {
    if (!dragging) return [];
    if (!selected.includes(dragging.id)) return [dragging];
    return selected
      .map((id) => groups.flatMap((g) => g.tasks).find((t) => t.id === id))
      .filter((t): t is Task => t !== undefined);
  });

  async function onPointerUp() {
    scroller.stop();
    if (mode === 'custom') {
      const order = customOrder;
      const moved = dragging !== null && order !== null;
      candidate = null;
      origin = null;
      dragging = null;
      customOrder = null;
      if (moved && order) {
        await app.reorderTasksInList(order);
        haptic('success');
      }
      return;
    }
    const carried = dragPayload;
    const key = hoverKey;
    candidate = null;
    origin = null;
    dragging = null;
    hoverKey = null;
    if (carried.length === 0 || !key || !mode) return;

    const tagName = app.state.tags.find((t) => t.id === key)?.name;
    let moved = 0;
    for (const task of carried) {
      const change = regroupPatch(task, mode, key, tagName);
      if (!change) continue; // already in that group — nothing to do
      await app.patchTask(task.id, change.patch);
      await app.markReviewed(task.id);
      moved += 1;
    }
    if (moved === 0) return;
    // A batch that has just landed somewhere is done being a batch.
    if (carried.length > 1) selected = [];
    haptic('success');
    app.fireEgg('taskDragged');
  }
</script>

<svelte:window onpointermove={onPointerMove} onpointerup={() => void onPointerUp()} />

<section class="groups" class:dragging={dragging !== null}>
  {#each shown as { group, tasks } (group.key)}
    {#if mode !== 'custom'}
    <h2
      class="group-header"
      class:drop-target={dragging !== null}
      class:hovered={hoverKey === group.key}
      data-group-key={group.key}
      data-testid="group-{group.key}">
      {group.label}
      {#if dragging && hoverKey === group.key}<span class="drop-hint">drop to move here</span>{/if}
      <button class="pick-group" data-testid="select-group-{group.key}"
        onclick={() => selectGroup(group)} title="select all in this group"><Glyph name="box-all" size={17} /></button>
    </h2>
    {/if}
    {#each mode === 'custom' && customOrder
      ? customOrder.map((cid) => tasks.find((t) => t.id === cid)).filter((t) => t !== undefined)
      : tasks as task (group.key + task.id)}
      <!-- Presentational drag wrapper; the row inside keeps all the semantics. -->
      <div
        class="draggable"
        role="presentation"
        animate:flip={{ duration: rowFlipMs }}
        data-drag-row={task.id}
        class:lifted={dragging?.id === task.id}
        class:picked={selected.includes(task.id)}
        onpointerdown={(e) => onPointerDown(e, task)}>
        <button class="pick" class:on={selected.includes(task.id)}
          data-testid="select-{task.id}" onclick={() => toggleSelect(task.id)}
          aria-label="select task"><Glyph name={selected.includes(task.id) ? 'box-all' : 'box'} size={15} /></button>
        {#if mode}
          <button class="grip" data-testid="drag-{task.id}" aria-label="drag to regroup"
            onpointerdown={(e) => onPointerDown(e, task, true)}>
            <Glyph name="grip" size={12} />
          </button>
        {/if}
        <TaskRow
          {task}
          {showList}
          {onenter}
          expanded={editingTaskId === task.id}
          ontoggle={() => {
            editingTaskId = editingTaskId === task.id ? null : task.id;
            if (editingTaskId) void app.markReviewed(task.id);
          }} />
      </div>
    {/each}
  {/each}
  {#if rendered < total}
    <div class="more" use:revealOnApproach={() => (budget += PAGE)} data-testid="rows-more">
      {rendered} of {total} — scroll for more
    </div>
  {/if}
</section>

{#if dragging}
  <div class="ghost" style="left: {pointerX}px; top: {pointerY}px">
    {#if dragPayload.length > 1}
      {dragPayload.length} tasks
    {:else}
      {dragging.name || 'untitled'}
    {/if}
  </div>
{/if}

{#if selectionMode}
  <div class="bulk" data-testid="bulk-bar">
    <span class="count">{selected.length} selected</span>
    <button data-testid="bulk-complete" onclick={() => void runBulk('complete')}>✓ done</button>
    <select data-testid="bulk-priority" bind:value={bulkPriority}
      onchange={() => bulkPriority && void runBulk('priority', bulkPriority)}>
      <option value="">→ priority…</option>
      {#each [...PRIORITIES].reverse() as p (p)}<option value={p}>→ {p}</option>{/each}
    </select>
    <select data-testid="bulk-tag" bind:value={bulkTag}
      onchange={() => bulkTag && void runBulk('tag', bulkTag)}>
      <option value="">+ tag…</option>
      {#each app.state.tags as t (t.id)}<option value={t.id}>+ {t.name}</option>{/each}
    </select>
    <select data-testid="bulk-move" bind:value={bulkList}
      onchange={() => bulkList && void runBulk('move', bulkList)}>
      <option value="">→ move to…</option>
      {#each app.state.lists as l (l.id)}<option value={l.id}>{l.title}</option>{/each}
    </select>
    <button class="danger" class:armed={deleteArmed} data-testid="bulk-delete"
      onclick={() => void confirmDelete()}>
      {deleteArmed ? `delete ${selected.length}?` : 'delete'}
    </button>
    <button class="clear" data-testid="bulk-clear" onclick={() => (selected = [])}>✕</button>
  </div>
{/if}

<style>
  .pick, .pick-group { display: inline-flex; align-items: center; justify-content: center; }

  .groups { display: flex; flex-direction: column; gap: 6px; }
  .more {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    text-align: center; padding: 14px 0 4px;
  }
  .groups.dragging { user-select: none; touch-action: none; }
  .group-header {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 14px 0 2px; font-weight: 600;
    display: flex; align-items: center; gap: 8px; border-radius: 6px; padding: 2px 4px;
  }
  .group-header.drop-target { outline: 1px dashed var(--line); outline-offset: 2px; }
  .group-header.hovered {
    color: var(--acc-green); outline-color: var(--acc-green);
    background: rgba(126, 231, 135, 0.08);
  }
  .drop-hint { font-size: 0.6rem; opacity: 0.8; text-transform: none; letter-spacing: 0; }
  .draggable { display: flex; align-items: stretch; gap: 4px; }
  .draggable.lifted { opacity: 0.35; }
  .draggable :global(.row) { flex: 1; min-width: 0; }
  .pick {
    flex: none; background: none; border: none; color: var(--dim);
    font-size: 0.95rem; cursor: pointer; padding: 0 2px; align-self: center;
  }
  .pick.on { color: var(--acc-cyan); }
  .grip {
    flex: none; align-self: center; background: none; border: none;
    color: var(--line); cursor: grab; padding: 6px 2px;
    /* The whole point: a drag starting here can never become a page scroll. */
    touch-action: none;
  }
  @media (hover: hover) { .grip:hover { color: var(--dim); } }
  .grip:active { cursor: grabbing; }
  .draggable.picked :global(.row) { border-color: var(--acc-cyan); }
  .pick-group {
    margin-left: auto; background: none; border: none; color: var(--dim);
    font-size: 0.8rem; cursor: pointer; padding: 0 4px;
  }
  @media (hover: hover) { .pick-group:hover { color: var(--acc-cyan); } }
  .bulk {
    position: fixed; z-index: 120;
    left: 50%; transform: translateX(-50%);
    bottom: calc(16px + env(safe-area-inset-bottom));
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap; justify-content: center;
    background: var(--bg2); border: 1px solid var(--acc-cyan); border-radius: 10px;
    padding: 8px 12px; max-width: 94vw;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
  }
  .count { color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.72rem; }
  .bulk button, .bulk select {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 5px 9px; cursor: pointer;
  }
  /*
    A native select's intrinsic minimum width is its LONGEST OPTION, and with a
    real library one long tag or list name makes the control wider than the
    whole bar — it burst straight through the border (reported with a
    screenshot, 2026-07-28). The closed control only ever needs to show its
    own label; the dropdown still shows every option at full length.
  */
  .bulk select { max-width: 34vw; min-width: 0; }
  .bulk .danger { color: var(--acc-magenta); }
  .bulk .danger.armed {
    background: var(--acc-magenta); border-color: var(--acc-magenta); color: var(--bg0);
  }
  .bulk .clear { color: var(--dim); border-color: transparent; }
  .ghost {
    position: fixed; z-index: 500; pointer-events: none;
    transform: translate(-50%, -140%);
    background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 8px;
    color: var(--text); font-size: 0.8rem; padding: 6px 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.55); max-width: 60vw;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
</style>
