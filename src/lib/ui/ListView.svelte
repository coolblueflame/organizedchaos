<!--
  Single-list screen (spec §6): sorted task groups (mode remembered per list),
  inline new-task that opens expanded, checkbox/delete on every row.
  Phase 3 adds the list-scoped randomizer button to the header.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { focusOnMount } from './focusOnMount';
  import { navigate } from './router.svelte';
  import {
    groupByDate, groupCustom, groupByPriority, groupByTag, subSortGroups,
    SUB_SORT_LABELS, type SubSort,
  } from '../domain/views';
  import type { SortMode } from '../domain/types';
  import GroupedTasks from './GroupedTasks.svelte';
  import { closeOnOutsideOrEscape } from './dismiss';
  import { revealOnApproach } from './lazyReveal';
  import TaskRow from './TaskRow.svelte';
  import Glyph from './Glyph.svelte';

  let { id, revealTaskId }: { id: string; revealTaskId?: string } = $props();

  let editingTaskId = $state<string | null>(null);

  // Deep link (#/list/<id>/task/<taskId>): arrive with that task's editor
  // open — the current-task card uses it to jump straight to the details.
  // Opening this way is a deliberate open, so it counts as triage like any
  // other; handled once per navigation, then the user owns the state.
  let revealed: string | undefined;
  $effect(() => {
    if (!revealTaskId || revealTaskId === revealed) return;
    revealed = revealTaskId;
    editingTaskId = revealTaskId;
    void app.markReviewed(revealTaskId);
  });

  // Tap-to-rename (parked polish, 2026-07-28 ask): the title IS the control.
  let renaming = $state(false);
  let titleDraft = $state('');
  function saveTitle() {
    // Escape sets renaming=false and the input's teardown still fires blur —
    // without this guard the abandoned draft saved anyway.
    if (!renaming) return;
    renaming = false;
    const t = titleDraft.trim();
    if (t && list && t !== list.title) void app.renameList(id, t);
  }

  const list = $derived(app.state.lists.find((l) => l.id === id));
  const listTasks = $derived(app.state.tasks.filter((t) => t.listId === id));

  const nextMode: Record<SortMode, SortMode> =
    { priority: 'date', date: 'tag', tag: 'custom', custom: 'priority' };

  /*
    The list's own history, Things-style: a collapsed section at the bottom.
    The COUNT is the headline — "12 of the 2026 goals are done" is readable
    without opening anything — and the rows page in on scroll because an
    imported list can hold years of them.
  */
  const completedHere = $derived(
    app.state.tasks
      .filter((t) => !t.deleted && t.listId === id && t.completedAt !== undefined)
      .sort((a, b) => b.completedAt! - a.completedAt!),
  );
  const openCount = $derived(
    app.state.tasks.filter((t) => !t.deleted && t.listId === id && t.completedAt === undefined).length,
  );
  const DONE_PAGE = 60;
  let doneBudget = $state(DONE_PAGE);
  let doneOpenId = $state<string | null>(null);
  let doneOpen = $state(false);

  const groups = $derived.by(() => {
    const mode = list?.sortMode ?? 'priority';
    const now = new Date();
    if (mode === 'date') return groupByDate(listTasks, app.state.settings, now);
    if (mode === 'tag') return groupByTag(listTasks, app.state.tags, app.state.settings, now);
    if (mode === 'custom') return groupCustom(listTasks);
    return groupByPriority(listTasks, app.state.settings, now);
  });

  let subSort = $state<SubSort>('smart');
  const SUB_CYCLE: SubSort[] = ['smart', 'alpha', 'created', 'newest'];
  const cycleSubSort = () => {
    subSort = SUB_CYCLE[(SUB_CYCLE.indexOf(subSort) + 1) % SUB_CYCLE.length]!;
  };
  const sortedGroups = $derived(
    list?.sortMode === 'custom' ? groups : subSortGroups(groups, subSort),
  );

  async function cycleSort() {
    if (!list) return;
    await app.setListSort(list.id, nextMode[list.sortMode]);
  }

  /**
   * Rapid entry (Things-style): a freshly created task that never got filled in
   * is discarded the moment you leave it — collapse, switch rows, Esc, or
   * navigate away. Nothing that was actually typed is ever thrown away.
   */
  async function stopEditing(): Promise<void> {
    const prev = editingTaskId;
    editingTaskId = null;
    if (prev) await app.discardIfPristine(prev);
  }

  /**
   * Synchronous for the same reason the Enter-chain is: iOS opens the keyboard
   * only for a focus landed inside the tap's own event turn. The old version
   * awaited two round-trips first, so the editor appeared with a dead keyboard
   * and the name field needed a second tap.
   */
  function newTask() {
    const prev = editingTaskId;
    editingTaskId = app.addTaskEager(id).id;
    if (prev) void app.discardIfPristine(prev); // background; writes are serialized
  }

  function toggle(taskId: string) {
    if (editingTaskId === taskId) {
      void stopEditing();
      return;
    }
    const prev = editingTaskId;
    editingTaskId = taskId;
    // Deliberately opening a task counts as giving it the once-over.
    void app.markReviewed(taskId);
    if (prev) void app.discardIfPristine(prev);
  }

  /** Enter commits and opens the next one; Enter on an empty name ends the chain. */
  /**
   * SYNCHRONOUS from keystroke to new editor — that is the entire fix for
   * fast typing bleeding into the just-committed task. Any await before
   * editingTaskId is a window where the old editor still owns the keyboard.
   */
  function chainNext(currentName: string) {
    if (!currentName.trim()) {
      void stopEditing();
      return;
    }
    editingTaskId = app.addTaskEager(id).id;
  }

  // Leaving the screen with an untouched new task open discards it too.
  $effect(() => () => {
    if (editingTaskId) void app.discardIfPristine(editingTaskId);
  });

  // Click-outside and Escape both collapse the open task (discarding it if it
  // was never filled in).
  $effect(() => closeOnOutsideOrEscape(() => editingTaskId !== null, () => void stopEditing()));
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    {#if renaming}
      <input class="title-input" data-testid="list-title-input" use:focusOnMount
        bind:value={titleDraft}
        onblur={saveTitle}
        onkeydowncapture={(e) => {
          if (e.key === 'Enter') saveTitle();
          // Capture phase: delegated keydown means a bubble-phase stop can't
          // keep this Escape from also collapsing an open task editor.
          if (e.key === 'Escape') { e.stopPropagation(); renaming = false; }
        }} />
    {:else}
      <button class="title" data-testid="list-title" title="tap to rename"
        onclick={() => { titleDraft = list?.title ?? ''; renaming = true; }}>
        <h1>{list?.title ?? '…'}</h1>
      </button>
    {/if}
    <button class="dice" data-testid="list-randomize" aria-label="randomize from this list"
      onclick={() => navigate({ name: 'randomizer', listId: id })}><Glyph name="dice" size={15} /></button>
    <button class="sort" data-testid="list-sort" onclick={cycleSort}>
      sort: {list?.sortMode ?? 'priority'}
    </button>
    {#if list?.sortMode !== 'custom'}
      <button class="sort" data-testid="list-subsort" onclick={cycleSubSort}
        title="order within each group">
        ↳ {SUB_SORT_LABELS[subSort]}
      </button>
    {/if}
  </header>

  <GroupedTasks
    groups={sortedGroups}
    mode={list?.sortMode ?? 'priority'}
    bind:editingTaskId
    onenter={chainNext} />
  {#if groups.length === 0}
    <p class="empty">// nothing here yet</p>
  {/if}

  <button class="new-task" data-testid="new-task" onclick={newTask}>+ new todo</button>

  <!-- Also floating (2026-07-29 ask): a long list should never make you scroll
       to the bottom just to add to it. Same synchronous newTask, so the
       keyboard comes up in the same tap. -->
  <button class="fab" data-testid="list-fab" aria-label="new todo" onclick={newTask}>+</button>

  {#if completedHere.length > 0}
    <details class="done-shelf" data-testid="list-completed" bind:open={doneOpen}>
      <!-- done/lifetime, e.g. 40/120: the fraction is the point — "a third of
           this list is behind me" reads instantly where a bare count doesn't. -->
      <summary>completed here · {completedHere.length}/{completedHere.length + openCount}</summary>
      <!-- Rendered only while open: a closed shelf must cost nothing and must
           not leave finished rows attached where tests and tooling would find
           them "still on the list". -->
      {#if doneOpen}
      <div class="done-rows">
        {#each completedHere.slice(0, doneBudget) as task (task.id)}
          <TaskRow {task} completedMode showCompletedAt expanded={doneOpenId === task.id}
            ontoggle={() => (doneOpenId = doneOpenId === task.id ? null : task.id)} />
        {/each}
        {#if completedHere.length > doneBudget}
          <div class="done-more" use:revealOnApproach={() => (doneBudget += DONE_PAGE)}>
            {doneBudget} of {completedHere.length} — scroll for more
          </div>
        {/if}
      </div>
      {/if}
    </details>
  {/if}
</main>

<style>
  .dice { display: inline-flex; align-items: center; justify-content: center; }

  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .title {
    flex: 1; min-width: 0; background: none; border: none; padding: 0;
    color: inherit; text-align: left; cursor: text;
  }
  .title h1 { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .title-input {
    flex: 1; min-width: 0;
    background: var(--bg2); border: 1px solid var(--acc-cyan); border-radius: 8px;
    color: var(--text); font-family: var(--font-mono); font-size: 1.05rem;
    padding: 6px 10px;
  }
  .dice {
    background: none; border: none; font-size: 1.1rem; cursor: pointer; padding: 4px 6px;
    filter: grayscale(0.3);
  }
  @media (hover: hover) { .dice:hover { filter: none; transform: scale(1.1); } }
  .sort {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 6px;
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.7rem;
    padding: 6px 10px; cursor: pointer;
  }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; }
  .new-task {
    margin-top: 16px; width: 100%; background: none; border: 1px dashed var(--line);
    border-radius: 8px; color: var(--dim); font-family: var(--font-mono);
    font-size: 0.85rem; padding: 12px; cursor: pointer; text-align: left;
  }
  @media (hover: hover) { .new-task:hover { color: var(--acc-green); border-color: var(--acc-green); } }
  .done-shelf { margin-top: 18px; }
  .done-shelf summary {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    cursor: pointer; padding: 6px 2px; list-style: none;
  }
  .done-shelf summary::before { content: '▸ '; }
  .done-shelf[open] summary::before { content: '▾ '; }
  @media (hover: hover) { .done-shelf summary:hover { color: var(--text); } }
  .done-rows { display: flex; flex-direction: column; gap: 4px; margin-top: 6px; opacity: 0.85; }
  .done-more {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    text-align: center; padding: 12px 0 4px;
  }
  .fab {
    position: fixed; z-index: 120;
    right: calc(16px + env(safe-area-inset-right));
    bottom: calc(18px + env(safe-area-inset-bottom));
    width: 52px; height: 52px; border-radius: 50%;
    background: var(--bg1); border: 1px solid var(--acc-green);
    color: var(--acc-green); font-size: 1.7rem; line-height: 1; cursor: pointer;
    box-shadow: 0 6px 24px rgba(0, 0, 0, 0.5);
    display: inline-flex; align-items: center; justify-content: center; padding: 0;
  }
  @media (hover: hover) { .fab:hover { background: var(--acc-green); color: var(--bg0); } }
</style>
