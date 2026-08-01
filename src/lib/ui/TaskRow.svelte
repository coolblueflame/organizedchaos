<!--
  One task row: checkbox, name, tag dots, deadline + priority glyphs.
  Tapping the body expands the editor; completed rows show restore instead.
-->
<script lang="ts">
  import { slide } from 'svelte/transition';
  import { app } from '../state/app.svelte';
  import { toast } from './toast.svelte';
  import { isEscalated, effectivePriority } from '../domain/priority';
  import { daysUntilDeadline } from '../domain/time';
  import { activeMs, completionCounts, formatElapsed } from '../domain/stats';
  import type { Task } from '../domain/types';
  import { tagColor } from './tagColors';
  import TaskEditor from './TaskEditor.svelte';
  import Glyph from './Glyph.svelte';
  import { describeRitualTask, isRitualTask, ritualState } from '../domain/ritual';
  import { checklistProgress } from '../domain/checklist';
  import { isLongSnooze } from '../domain/sweep';
  import { estimateOutcome } from '../domain/stats';

  /** Svelte action: scroll the freshly opened editor into view. */
  function revealEditor(node: HTMLElement) {
    // Next frame: the editor needs a layout pass before its height is real.
    requestAnimationFrame(() => {
      node.scrollIntoView({ block: 'nearest', behavior: motionOk() ? 'smooth' : 'auto' });
    });
  }
  import { motionOk } from './fx/particles';
  import { celebrateFromElement } from './fx/celebrate';
  import { haptic } from './fx/haptics';

  let {
    task, expanded = false, ontoggle, onenter, showList = false, completedMode = false,
    showCompletedAt = false,
  }: {
    task: Task;
    expanded?: boolean;
    ontoggle: () => void;
    /** Enter in the name field — the list view chains a new task (rapid entry). */
    onenter?: (currentName: string) => void;
    showList?: boolean;
    completedMode?: boolean;
    /** Show when it was finished (search results; the Completed screen groups by day instead). */
    showCompletedAt?: boolean;
  } = $props();

  const now = new Date();
  const effective = $derived(effectivePriority(task, app.state.settings, now));
  const escalated = $derived(isEscalated(task, app.state.settings, now));
  const overdue = $derived(
    task.deadline !== undefined &&
    daysUntilDeadline(task.deadline, now, app.state.settings.rolloverHour) < 0,
  );
  // Only recomputed when this task's own blockedBy changes, not on every edit
  // anywhere: the id list is the cheap thing to watch, the lookup the costly one.
  const blockerCount = $derived(
    (task.blockedBy ?? []).filter((id) => {
      const b = app.state.tasks.find((t) => t.id === id);
      return b !== undefined && !b.deleted && b.completedAt === undefined;
    }).length,
  );
  const blocked = $derived(blockerCount > 0);
  /* Recomputed per render rather than on a clock: a ritual crossing into its
     window mid-stare is not worth a ticking timer, and every navigation or edit
     re-renders anyway. */
  const ritual = $derived(ritualState(task, new Date(), app.state.settings.rolloverHour));
  /** A page marker so you can see there's detail worth expanding for. */
  const hasNotes = $derived(task.notes.trim().length > 0);
  /** A checklist inside the notes upgrades the marker to a live count. */
  const checkProgress = $derived(checklistProgress(task.notes));
  const listTitle = $derived(app.state.lists.find((l) => l.id === task.listId)?.title);
  const rowTags = $derived(task.tagIds
    .map((id) => app.state.tags.find((t) => t.id === id))
    .filter((t) => t !== undefined));

  let checkEl: HTMLButtonElement | undefined = $state();
  let completing = $state(false);

  // The row title IS the name field (no duplicate input in the editor below):
  // expanding focuses it with the text selected, ready to retype.
  let nameEl: HTMLInputElement | undefined = $state();
  // svelte-ignore state_referenced_locally
  let nameDraft = $state(task.name);
  let nameTimer: ReturnType<typeof setTimeout> | undefined;

  function queueNameSave() {
    clearTimeout(nameTimer);
    // First real keystroke saves immediately so the task stops being "pristine"
    // before any discard check can run; the rest debounce normally.
    if (task.name === '' && nameDraft.trim() !== '') {
      void flushName();
      return;
    }
    nameTimer = setTimeout(() => void flushName(), 400);
  }

  async function flushName(): Promise<void> {
    clearTimeout(nameTimer);
    if (nameDraft !== task.name) await app.patchTask(task.id, { name: nameDraft });
  }

  /** Always flush BEFORE handing control back, so no save is left in flight. */
  async function collapse() {
    await flushName();
    ontoggle();
  }

  function onNameKey(e: KeyboardEvent) {
    // Escape is handled globally (closeOnOutsideOrEscape), which blurs this
    // field first so the name flushes — handling it here too would double-close.
    if (e.key !== 'Enter') return;
    // NOT awaited: patchTask commits the mirror synchronously inside this
    // call, and awaiting the disk write would reopen the exact keystroke
    // window the eager chain exists to close. The write itself is serialized
    // behind any in-flight insert by the repo.
    void flushName();
    if (onenter) onenter(nameDraft);
    else ontoggle();
  }

  const coarsePointer =
    typeof window !== 'undefined' && (window.matchMedia?.('(pointer: coarse)').matches ?? false);

  /**
   * Expanding a task focuses and selects its name so you can retype it
   * immediately — but on a phone that throws the keyboard over the editor you
   * were trying to read, every time you open a task (reported from an iPhone,
   * 2026-07-27). So on touch, opening an EXISTING task leaves the keyboard
   * down and waits for a deliberate tap on the field.
   *
   * A task with no name yet is the exception: that's the rapid-entry chain,
   * where the user pressed Enter to make this row and is mid-flow typing. Not
   * focusing there would break the chain on exactly the device it matters on.
   */
  const autoFocusName = $derived(!coarsePointer || task.name.trim() === '');

  $effect(() => {
    if (expanded && nameEl && autoFocusName) {
      nameEl.focus();
      nameEl.select();
    }
  });

  /**
   * The deliberate tap that finally focuses the field selects its text, so
   * retyping still replaces the name. Hooked to focus rather than click on
   * purpose: the browser focuses an input on pointer-down, so by click time it
   * is already active and "was it focused before?" can no longer be asked.
   * Focus fires once per session, so tapping again to move the caret behaves
   * normally instead of re-selecting everything under your finger.
   */
  function onNameFocus() {
    if (!coarsePointer) return;
    // Deferred by a tick: focus arrives on pointer-down, and the pointer-up
    // that follows collapses any selection to a caret where you tapped. This
    // runs after that, so the selection survives.
    setTimeout(() => nameEl?.select(), 0);
  }

  function complete() {
    if (completing) return;
    completing = true;
    // Juice is garnish — the mutation below runs even if fx throw (spec P5).
    try {
      if (checkEl) {
        const done = completionCounts(app.state.tasks, new Date(), app.state.settings.rolloverHour);
        celebrateFromElement(checkEl, { completionsToday: done.today + 1 });
      }
      haptic('success');
    } catch { /* never block completion on fx */ }
    setTimeout(() => {
      // Release the flag once the mutation settles. Ordinary rows unmount on
      // completion so this is moot for them — but a RITUAL's row stays (it has
      // to exist tomorrow), and a stuck flag left its box ticked forever and
      // ate every later tap: the next window of a per-window ritual, or the
      // fresh completion after an undo.
      void app.completeTask(task.id).finally(() => (completing = false));
    }, motionOk() ? 280 : 0);
  }

  function restore() {
    void app.uncompleteTask(task.id);
  }

  // Two-stage delete: the first tap arms, the second commits. Cheap insurance
  // against a mis-tap; the undo toast still covers the rest.
  let deleteArmed = $state(false);
  let armTimer: ReturnType<typeof setTimeout> | undefined;

  function remove() {
    if (!deleteArmed) {
      deleteArmed = true;
      clearTimeout(armTimer);
      armTimer = setTimeout(() => (deleteArmed = false), 3000);
      return;
    }
    clearTimeout(armTimer);
    deleteArmed = false;
    void app.removeTask(task.id); // the store records the undo
  }

  const shortDate = (key: string) => {
    const [, m, d] = key.split('-');
    return `${Number(m)}/${Number(d)}`;
  };
</script>

<div class="row" class:expanded transition:slide={{ duration: 220 }}
  data-editing-root={expanded ? '' : undefined} data-testid="task-row-{task.id}">
  <div class="line">
    {#if completedMode}
      <!-- A ticked box you untick: the same gesture that completed it, in reverse. -->
      <button class="restore" data-testid="task-restore-{task.id}" onclick={restore}
        aria-label="mark as not done" title="mark as not done">
        <Glyph name="box-checked" size={15} />
      </button>
    {:else}
      <button class="check" class:completing bind:this={checkEl}
        data-testid="task-check-{task.id}" onclick={complete} aria-label="complete">
        {#if completing}<Glyph name="check" size={13} />{/if}
      </button>
    {/if}

    {#if expanded && !completedMode}
      <input
        class="name-input"
        data-testid="task-name-input"
        placeholder="task name"
        bind:this={nameEl}
        bind:value={nameDraft}
        oninput={queueNameSave}
        onblur={() => void flushName()}
        onfocus={onNameFocus}
        onkeydown={onNameKey} />
    {:else}
    <!-- Two stacked rows (2026-08-01 night ask): the title WRAPS, never
         truncates — badges + tag names were squeezing it to a sliver. Tags
         live on their own smaller line below. -->
    <button class="body stacked" onclick={ontoggle}>
      <span class="body-top">
      <span class="name" class:done={completedMode}>{task.name || 'untitled'}</span>
      {#if showList && listTitle}<span class="list-tag">{listTitle}</span>{/if}
      <span class="badges">
        <!-- Text, not a dot (2026-08-01 ask): the yellow review dot read as
             another priority colour. -->
        {#if task.needsReview && !completedMode}
          <span class="review-badge" data-testid="needs-review-{task.id}"
            title="not triaged yet — open it or set a field">NEW</span>
        {/if}
        {#if showCompletedAt && task.completedAt}
          <span class="done-at">✓ {new Date(task.completedAt).toLocaleDateString()}</span>
        {/if}
        {#if completedMode && activeMs(task)}
          <span class="done-at" title="time from picking it up to finishing">
            ⧗ {formatElapsed(activeMs(task)!)}
          </span>
        {/if}
        {#if checkProgress}
          <span class="mark check-count" class:all-done={checkProgress.done === checkProgress.total}
            data-testid="check-count-{task.id}"
            title="checklist inside — expand to tick things off">
            <Glyph name="box-checked" size={11} /> {checkProgress.done}/{checkProgress.total}
          </span>
        {:else if hasNotes}
          <span class="mark" data-testid="has-notes-{task.id}">
            <Glyph name="notes" size={11} title="has a description — expand to read it" />
          </span>
        {/if}
        {#if blocked && !completedMode}
          <span class="mark blocked-mark" data-testid="blocked-mark-{task.id}">
            <Glyph name="blocked" size={11}
              title="waiting on {blockerCount} unfinished task{blockerCount === 1 ? '' : 's'} — the randomizer will skip it" />
          </span>
        {/if}
        {#if task.inProgress && !completedMode}
          <span class="mark started" data-testid="inprogress-mark-{task.id}">
            <Glyph name="play" size={11} title="in progress — the clock may be running" />
          </span>
        {/if}
        {#if isRitualTask(task) && !completedMode}
          <span class="mark" class:ritual-due={ritual === 'due'} class:ritual-done={ritual === 'done'}
            data-testid="ritual-mark-{task.id}">
            <Glyph name="period" size={11}
              title={ritual === 'done' ? `done today · ${describeRitualTask(task)}`
                : ritual === 'due' ? `due now · ${describeRitualTask(task)}`
                : `daily · ${describeRitualTask(task)}`} />
          </span>
        {/if}
        {#if !completedMode && isLongSnooze(task, new Date(), app.state.settings.rolloverHour)}
          <span class="mark snoozed" data-testid="snoozed-mark-{task.id}">
            <Glyph name="moon" size={11}
              title="asleep until {new Date(task.notTodayUntil!).toLocaleDateString()} — the randomizer skips it until then" />
          </span>
        {/if}
        {#if !completedMode && task.timeboxMinutes}
          <span class="mark" data-testid="timeboxed-{task.id}">
            <Glyph name="timebox" size={11}
              title="timeboxed to {task.timeboxMinutes} minutes on accept" />
          </span>
        {/if}
        {#if task.deadline && !completedMode}
          <span class="deadline" class:overdue>{shortDate(task.deadline)}</span>
        {/if}
        {#if escalated}<span class="flame"><Glyph name="escalate" size={10} title="escalated by deadline" /></span>{/if}
        <span class="prio {effective}"></span>
      </span>
      </span>
      {#if rowTags.length > 0}
        <!-- The tag line: names, not dots (2026-08-01 — colour circles carry
             nothing at 124 tags), on their own row so the title keeps its
             whole width. -->
        <span class="tag-row">
          {#each rowTags.slice(0, 4) as t (t.id)}
            <span class="tag-name" style="color: {tagColor(t.colorIndex)}">{t.name}</span>
          {/each}
          {#if rowTags.length > 4}
            <span class="tag-name more">+{rowTags.length - 4}</span>
          {/if}
        </span>
      {/if}
    </button>
    {/if}

    {#if !completedMode && !expanded}
      <button class="delete" class:armed={deleteArmed} data-testid="task-delete-{task.id}"
        onclick={remove} aria-label={deleteArmed ? 'tap again to delete' : 'delete'}>
        {deleteArmed ? 'sure?' : '✕'}
      </button>
    {/if}
  </div>

  {#if expanded && !completedMode}
    <!-- Bring the editor fully on screen when it opens near the bottom:
         block 'nearest' scrolls only as far as needed, so a mid-screen
         expansion doesn't jump at all. -->
    <div use:revealEditor>
      <TaskEditor {task} oncollapse={() => void collapse()} />
    </div>
  {/if}

  <!-- A finished task opens too (2026-07-29 request): read what it was, and
       re-file it — moving finished work into a goals list is how a year gets
       measured against its January list. Lean on purpose: history wants
       reading and filing, not the full editor. -->
  {#if expanded && completedMode}
    <div class="done-detail" data-testid="done-detail-{task.id}">
      {#if task.notes.trim()}
        <p class="done-notes">{task.notes}</p>
      {:else}
        <p class="done-notes dim">// no description</p>
      {/if}
      {#if task.completedAt}
        <p class="done-meta">completed {new Date(task.completedAt).toLocaleString()}</p>
      {/if}
      {#if estimateOutcome(task)}
        {@const outcome = estimateOutcome(task)!}
        <p class="done-meta est" data-testid="done-estimate-{task.id}">
          estimated {outcome.estimate} · took {outcome.actual} — {outcome.verdict}
        </p>
      {/if}
      <label class="done-move">
        <span>list</span>
        <select data-testid="done-move-{task.id}" value={task.listId}
          onchange={(e) => void app.moveTask(task.id, e.currentTarget.value)}>
          {#each app.state.lists.filter((l) => l.archived !== true) as l (l.id)}
            <option value={l.id}>{l.title}</option>
          {/each}
        </select>
      </label>
    </div>
  {/if}
</div>

<style>
  .flame { display: inline-flex; align-items: center; }

  .row {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    padding: 0 10px;
  }
  .row.expanded { border-color: var(--acc-blue); }
  .line { display: flex; align-items: center; gap: 10px; min-height: 44px; }
  .check {
    width: 20px; height: 20px; flex: none; border-radius: 6px;
    border: 1.5px solid var(--dim); background: none; cursor: pointer;
    display: inline-flex; align-items: center; justify-content: center; padding: 0;
  }
  @media (hover: hover) { .check:hover { border-color: var(--acc-green); box-shadow: 0 0 6px var(--acc-green); } }
  .check.completing {
    border-color: var(--acc-green); background: var(--acc-green);
    box-shadow: 0 0 10px var(--acc-green);
    transition: background 0.15s ease, box-shadow 0.15s ease;
  }
  /* The tick is DRAWN, not typed: a text ✓'s ink sits left of its em box, so
     it never centred no matter what the alignment said. The glyph's path is
     symmetric about the viewBox middle, and flex does the rest. */
  .check.completing { color: var(--bg0); }
  .restore {
    width: 24px; height: 24px; flex: none; background: none; border: none;
    color: var(--acc-green); cursor: pointer; padding: 0;
    display: inline-flex; align-items: center; justify-content: center;
  }
  @media (hover: hover) { .restore:hover { color: var(--acc-cyan); } }
  .done-detail {
    display: flex; flex-direction: column; gap: 8px;
    border-top: 1px dashed var(--line); margin-top: 6px; padding: 10px 2px 4px;
  }
  .done-notes { margin: 0; color: var(--text); font-size: 0.85rem; line-height: 1.55; white-space: pre-wrap; overflow-wrap: anywhere; }
  .done-notes.dim { color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }
  .done-meta { margin: 0; color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; }
  .done-meta.est { color: var(--acc-cyan); }
  .done-move { display: flex; align-items: center; gap: 8px; }
  .done-move span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .done-move select {
    flex: 1; min-width: 0; max-width: 100%;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 6px 8px; font-size: 0.8rem; outline: none;
  }
  .mark.started { color: var(--acc-green); }
  .mark.snoozed { color: var(--acc-purple); }
  .mark.ritual-due { color: var(--acc-magenta); }
  .mark.ritual-done { color: var(--acc-green); }
  .body {
    flex: 1; display: flex; align-items: center; gap: 8px; background: none; border: none;
    color: var(--text); font-size: 0.9rem; padding: 10px 0; cursor: pointer;
    text-align: left; min-width: 0;
  }
  /* Two stacked lines: title row (name wraps, badges hug the right) and the
     smaller tag line beneath it. */
  .body.stacked { flex-direction: column; align-items: stretch; gap: 2px; }
  .body-top { display: flex; align-items: center; gap: 8px; min-width: 0; }
  /* Never truncated (2026-08-01 night ask) — the name takes the width it
     needs and WRAPS; badges yield rather than squeeze it out. */
  .name { flex: 1; min-width: 0; overflow-wrap: anywhere; }
  .name.done { text-decoration: line-through; color: var(--dim); }
  /* Reads as the title, behaves as the field — same size, same weight, no chrome. */
  .name-input {
    flex: 1; min-width: 0; background: none; border: none;
    border-bottom: 1px solid var(--acc-blue);
    color: var(--text); font-size: 0.9rem; font-family: inherit;
    padding: 11px 0 9px; outline: none;
  }
  .name-input::placeholder { color: var(--dim); }
  .list-tag { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; flex: none; }
  .badges { margin-left: auto; display: flex; align-items: center; gap: 5px; flex: none; min-width: 0; }
  .tag-row { display: flex; flex-wrap: wrap; gap: 4px 8px; min-width: 0; }
  .tag-name {
    font-family: var(--font-mono); font-size: 0.62rem; opacity: 0.85;
    max-width: 130px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .tag-name.more { color: var(--dim); }
  .review-badge {
    color: var(--acc-yellow); border: 1px solid color-mix(in srgb, var(--acc-yellow) 55%, transparent);
    border-radius: 4px; padding: 0 4px;
    font-family: var(--font-mono); font-size: 0.58rem; font-weight: 700; letter-spacing: 0.06em;
  }
  .deadline { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .done-at { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; }
  .deadline.overdue { color: var(--acc-magenta); font-weight: 700; }
  .flame { color: var(--acc-orange); font-size: 0.65rem; }
  .mark { display: inline-flex; align-items: center; color: var(--dim); }
  .check-count { gap: 3px; font-family: var(--font-mono); font-size: 0.65rem; }
  .check-count.all-done { color: var(--acc-green); }
  /* The one that means "you can't do this yet" earns a warmer colour. */
  .blocked-mark { color: var(--acc-orange); }
  .prio { width: 8px; height: 8px; border-radius: 50%; }
  .prio.someday { background: var(--dim); opacity: 0.4; }
  .prio.low { background: var(--acc-blue); }
  .prio.medium { background: var(--acc-green); }
  .prio.high { background: var(--acc-orange); }
  .prio.max { background: var(--acc-magenta); }
  .delete {
    background: none; border: none; color: var(--dim); cursor: pointer;
    font-size: 0.8rem; padding: 4px; flex: none;
  }
  @media (hover: hover) { .delete:hover { color: var(--acc-magenta); } }
  .delete.armed {
    color: var(--acc-magenta); font-family: var(--font-mono); font-size: 0.7rem;
    border: 1px solid var(--acc-magenta); border-radius: 6px; padding: 3px 7px;
  }
  @media (hover: hover) {
    .delete { opacity: 0; }
    @media (hover: hover) { .row:hover .delete { opacity: 1; } }
    .delete.armed { opacity: 1; }
  }
</style>
