<!--
  Expanded task editor (spec §6): unlabeled name + notes on top, then priority,
  tags, deadline, estimate. Recurrence editor arrives in Phase 4 (placeholder row).
  Text fields save on debounce + blur; discrete fields save immediately.
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import { app } from '../state/app.svelte';
  import { pickerListGroups } from '../domain/listOrder';
  import { describeRitualTask, isRitualTask, ritualWindows } from '../domain/ritual';
  import { ALL_DAYS } from '../domain/schedule';
  import { navigate } from './router.svelte';
  import type { Task } from '../domain/types';
  import PrioritySelect from './PrioritySelect.svelte';
  import TagPicker from './TagPicker.svelte';
  import BlockedBy from './BlockedBy.svelte';
  import RecurrenceEditor from './RecurrenceEditor.svelte';
  import { describeRecurrence } from './recurrenceText';
  import { activeMs, formatElapsed } from '../domain/stats';
  import { liveQueueIds } from '../domain/dayQueue';
  import Checklist from './Checklist.svelte';
  import type { RecurrenceMode } from '../domain/types';
  import Glyph from './Glyph.svelte';
  import { autogrow } from './autogrow';
  import EstimateField from './EstimateField.svelte';

  let { task, oncollapse, compact = false }: {
    task: Task;
    oncollapse: () => void;
    /** Quick add supplies its own buttons — hide the row-editor's own controls. */
    compact?: boolean;
  } = $props();

  /** The move-to choices, grouped and ordered the way the home screen reads. */
  const listGroups = $derived(pickerListGroups(app.state.lists));

  // The name field lives in TaskRow (the row title IS the input). This editor
  // owns notes only. Draft copy is intentional: it holds text while typing and
  // flushes on debounce/blur; rows are keyed, so props never swap under us.
  // svelte-ignore state_referenced_locally
  let notes = $state(task.notes);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  function flush() {
    clearTimeout(saveTimer);
    if (notes !== task.notes) {
      void app.patchTask(task.id, { notes });
      touched();
    }
  }

  /** Every checklist interaction rides the same save path as typing. */
  function notesChanged(next: string) {
    notes = next;
    flush();
  }

  /**
   * Any deliberate interaction with a field OTHER than the name counts as
   * triage — even re-picking the value it already had (that's a decision).
   */
  function touched() {
    void app.markReviewed(task.id);
  }

  function toggleTag(tagId: string) {
    const tagIds = task.tagIds.includes(tagId)
      ? task.tagIds.filter((id) => id !== tagId)
      : [...task.tagIds, tagId];
    void app.patchTask(task.id, { tagIds });
    touched();
  }

  function setDeadline(value: string) {
    void app.patchTask(task.id, { deadline: value || undefined });
    touched();
  }

  /** EstimateField has already parsed and guarded partial input. */
  function setEstimate(hours: number | undefined) {
    void app.patchTask(task.id, { estimateHours: hours });
    touched();
  }

  // Same two-stage arming as the row's delete — a mis-tap in here was deleting
  // immediately, which is exactly the friction this was supposed to add.
  let deleteArmed = $state(false);

  /** Position in the day queue (0-based), or null when not queued. */
  const queuePos = $derived.by(() => {
    const live = liveQueueIds(app.state.queueIds, app.state.tasks);
    const at = live.indexOf(task.id);
    return at === -1 ? null : at;
  });
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
    flush();
    void app.removeTask(task.id); // the store records the undo
  }

  // "Jan 1, 2026", not locale digits: all-numeric dates read ambiguously
  // (which pair is the month?) — Ben's 2026-08-01 ask.
  const fmt = (ts: number) =>
    new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  // ── recurrence ─────────────────────────────────────────────────────────
  let recurOpen = $state(false);

  // ── daily ritual ──────────────────────────────────────────────────────────
  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
  let ritualOpen = $state(false);
  /** The windows being edited (2026-07-29: a ritual can have several a day).
      `toTouched`: the user set the end themselves — stop auto-following the start. */
  let ritualWins = $state<Array<{ from: string; to: string; days: number[]; toTouched?: boolean }>>([]);
  let ritualEach = $state(false);

  // Seed the form from the task each time it opens, not reactively: editing the
  // fields must not be fought by the value they came from.
  $effect(() => {
    if (!ritualOpen) return;
    const existing = untrack(() => ritualWindows(task));
    const each = untrack(() => task.ritualPerWindow === true);
    ritualWins = existing.length > 0
      // Saved windows are the user's: never auto-adjust their ends.
      ? existing.map((w) => ({ from: w.from, to: w.to, days: [...w.days], toTouched: true }))
      : [{ from: nearestHour(), to: nearestHour(1), days: [...ALL_DAYS] }];
    ritualEach = each;
  });

  /** "HH:MM" for the hour nearest to now, +offsetH — never with minutes to drag off. */
  function nearestHour(offsetH = 0): string {
    const d = new Date();
    const h = (d.getHours() + (d.getMinutes() >= 30 ? 1 : 0) + offsetH) % 24;
    return `${String(h).padStart(2, '0')}:00`;
  }

  /** from + 1h, wrapping midnight; '' passes through untouched. */
  function hourAfter(from: string): string {
    const m = from.match(/^(\d{2}):(\d{2})$/);
    if (!m) return '';
    return `${String((Number(m[1]) + 1) % 24).padStart(2, '0')}:${m[2]}`;
  }

  function addRitualWindow() {
    // A fresh window borrows the last one's days — "drink water" repeats the
    // same day pattern far more often than it varies it. Times seed to the
    // nearest whole hour, one hour long (2026-08-01 ask): an empty time input
    // opens the picker at the CURRENT minute, and dragging minutes back to
    // ":00" on every window got old fast.
    const prev = ritualWins[ritualWins.length - 1];
    const from = nearestHour();
    ritualWins = [...ritualWins, {
      from, to: hourAfter(from), days: prev ? [...prev.days] : [...ALL_DAYS],
    }];
  }

  /** Picking a start re-seeds the end an hour later — until the user has
      deliberately set an end of their own, which then stays theirs. */
  function ritualFromChanged(i: number) {
    const win = ritualWins[i];
    if (!win) return;
    if (!win.toTouched) win.to = hourAfter(win.from);
  }

  function dropRitualWindow(i: number) {
    ritualWins = ritualWins.filter((_, x) => x !== i);
  }

  function toggleRitualDay(i: number, d: number) {
    ritualWins = ritualWins.map((w, x) => x === i
      ? { ...w, days: w.days.includes(d) ? w.days.filter((y) => y !== d) : [...w.days, d] }
      : w);
  }

  async function saveRitual() {
    const valid = ritualWins
      .filter((w) => w.days.length > 0 && w.from && w.to && w.from !== w.to)
      .map((w) => ({ days: [...w.days].sort((a, b) => a - b), from: w.from, to: w.to }));
    if (valid.length === 0) { ritualOpen = false; return; }
    await app.patchTask(task.id, {
      rituals: valid,
      // Legacy mirror: an old build reads `ritual` only, so it at least sees
      // the first window instead of losing the ritual entirely.
      ritual: valid[0],
      ritualPerWindow: valid.length > 1 && ritualEach ? true : undefined,
      // Window indices are the done-marks' identity; edits reshuffle them, so
      // today's marks stop meaning anything trustworthy. Start the day clean.
      ritualDoneSlots: undefined,
    });
    touched();
    ritualOpen = false;
  }

  async function removeRitual() {
    await app.patchTask(task.id, {
      ritual: undefined, rituals: undefined, ritualPerWindow: undefined,
      ritualDoneDay: undefined, ritualDoneSlots: undefined,
    });
    ritualOpen = false;
  }

  const template = $derived(task.recurrenceId
    ? app.state.templates.find((t) => t.id === task.recurrenceId && !t.deleted)
    : undefined);

  async function saveRecurrence(mode: RecurrenceMode, deadlineOffsetDays?: number) {
    if (template) {
      await app.updateRecurring(template.id, { mode, deadlineOffsetDays });
    } else {
      await app.createRecurring(task.id, mode, deadlineOffsetDays);
    }
    touched();
    recurOpen = false;
  }

  async function stopRecurrence() {
    if (template) {
      await app.removeRecurring(template.id);
      await app.patchTask(task.id, { recurrenceId: undefined });
    }
    recurOpen = false;
  }
</script>

<div class="editor">
  <textarea class="notes" data-testid="task-notes-input" placeholder="notes"
    rows="2" use:autogrow={notes} bind:value={notes} oninput={queueSave} onblur={flush}></textarea>
  <Checklist {notes} taskId={task.id} onchange={notesChanged} allowAdd />

  <PrioritySelect value={task.priority}
    onchange={(p) => { void app.patchTask(task.id, { priority: p }); touched(); }} />

  <TagPicker selected={task.tagIds} ontoggle={toggleTag} />

  <label class="move">
    <span>list</span>
    <select data-testid="task-move-list" value={task.listId}
      onchange={(e) => { void app.moveTask(task.id, e.currentTarget.value); touched(); }}>
      {#each listGroups as g (g.group)}
        {#if g.group === ''}
          {#each g.lists as l (l.id)}<option value={l.id}>{l.title}</option>{/each}
        {:else}
          <optgroup label={g.group}>
            {#each g.lists as l (l.id)}<option value={l.id}>{l.title}</option>{/each}
          </optgroup>
        {/if}
      {/each}
      <!-- A task can live somewhere the picker no longer offers (an archived
           list, a dice-made vessel) — its home must still display, or the
           select silently claims the wrong list. Not a move target for
           OTHER tasks; for this one it is simply the truth. -->
      {#if !listGroups.some((g) => g.lists.some((l) => l.id === task.listId))}
        <option value={task.listId}>
          {app.state.lists.find((l) => l.id === task.listId)?.title ?? 'its current list'}
        </option>
      {/if}
    </select>
  </label>

  <div class="fields">
    <label>
      <span>deadline</span>
      <!-- oninput AND onchange: a deadline edit can re-group (and remount) this
           row, so waiting for blur would lose the value (found via screenshot QA) -->
      <input type="date" data-testid="task-deadline-input" value={task.deadline ?? ''}
        oninput={(e) => setDeadline(e.currentTarget.value)}
        onchange={(e) => setDeadline(e.currentTarget.value)} />
    </label>
    <label>
      <span>timebox (min)</span>
      <input type="number" data-testid="task-timebox-input" min="1" step="5"
        value={task.timeboxMinutes ?? ''} placeholder="none"
        onchange={(e) => {
          const m = parseInt(e.currentTarget.value, 10);
          void app.patchTask(task.id, { timeboxMinutes: m > 0 ? m : undefined });
          touched();
        }} />
    </label>
    <label>
      <span>estimate</span>
      <EstimateField hours={task.estimateHours} testid="task-estimate-input"
        onchange={setEstimate} />
    </label>
  </div>

  <BlockedBy {task} />

  {#if recurOpen}
    <RecurrenceEditor
      initial={template ? { mode: template.mode, deadlineOffsetDays: template.deadlineOffsetDays } : undefined}
      onsave={saveRecurrence}
      oncancel={() => (recurOpen = false)}
      onremove={template ? stopRecurrence : undefined} />
  {:else}
    <button class="repeat-row" class:linked={!!template} data-testid="task-recur-row"
      onclick={() => (recurOpen = true)}>
      {#if template}↻ {describeRecurrence(template.mode, template.deadlineOffsetDays)}{#if template.paused}&nbsp;(paused){/if}
      {:else}↻ make recurring{/if}
    </button>
  {/if}

  {#if task.notTodayUntil && task.notTodayUntil > Date.now()}
    <button class="repeat-row snoozed" data-testid="task-wake"
      onclick={() => { void app.patchTask(task.id, { notTodayUntil: undefined }); touched(); }}>
      ☾ asleep until {new Date(task.notTodayUntil).toLocaleDateString()} — tap to wake
    </button>
  {/if}

  <!--
    A daily ritual sits next to recurrence on purpose: they are the two ways a
    task repeats, and the difference between them is the thing a user has to
    understand. Recurrence spawns copies and accumulates; a ritual does neither.
  -->
  {#if ritualOpen}
    <div class="ritual-editor">
      {#each ritualWins as win, i (i)}
        <div class="ritual-window">
          <div class="ritual-row" class:has-drop={ritualWins.length > 1}>
            <label><span>from</span>
              <input type="time" data-testid={i === 0 ? 'ritual-from' : `ritual-from-${i}`}
                bind:value={win.from} onchange={() => ritualFromChanged(i)} /></label>
            <label><span>until</span>
              <input type="time" data-testid={i === 0 ? 'ritual-to' : `ritual-to-${i}`}
                bind:value={win.to} onchange={() => (win.toTouched = true)} /></label>
            {#if ritualWins.length > 1}
              <button class="win-drop" data-testid="ritual-window-drop-{i}"
                aria-label="remove this time" onclick={() => dropRitualWindow(i)}>✕</button>
            {/if}
          </div>
          <div class="days">
            {#each DAY_LABELS as label, d (d)}
              <button class="day" class:on={win.days.includes(d)}
                data-testid={i === 0 ? `ritual-day-${d}` : `ritual-day-${i}-${d}`}
                onclick={() => toggleRitualDay(i, d)}>{label}</button>
            {/each}
          </div>
        </div>
      {/each}
      <button class="win-add" data-testid="ritual-add-window" onclick={addRitualWindow}>
        + another time
      </button>
      {#if ritualWins.length > 1}
        <label class="each" data-testid="ritual-each-row">
          <input type="checkbox" data-testid="ritual-each" bind:checked={ritualEach} />
          each time counts separately
          <span class="each-hint">{ritualEach
            ? '— it comes up again at every window (drink water)'
            : '— any one window does the whole day (walk the dogs)'}</span>
        </label>
      {/if}
      <p class="ritual-note">
        Inside a window it becomes the randomizer's top pick until it's done.
        Miss a day and nothing piles up — it just comes round again tomorrow.
      </p>
      <div class="ritual-actions">
        <button data-testid="ritual-save" onclick={saveRitual}>save</button>
        <button data-testid="ritual-cancel" onclick={() => (ritualOpen = false)}>cancel</button>
        {#if isRitualTask(task)}
          <button class="drop" data-testid="ritual-remove" onclick={removeRitual}>remove</button>
        {/if}
      </div>
    </div>
  {:else}
    <button class="repeat-row" class:linked={isRitualTask(task)} data-testid="task-ritual-row"
      onclick={() => (ritualOpen = true)}>
      {#if isRitualTask(task)}⧗ daily · {describeRitualTask(task)}
      {:else}⧗ make it a daily ritual{/if}
    </button>
  {/if}

  {#if !compact}
  <div class="flow-row">
    <button class="flow" data-testid="task-make-current"
      onclick={() => { flush(); void app.acceptTask(task.id).then(() => navigate({ name: 'home' })); }}>
      <Glyph name="play" size={10} /> make current
    </button>
    <button class="flow" class:active={task.inProgress} data-testid="task-inprogress-toggle"
      onclick={() => void app.setInProgress(task.id, !task.inProgress)}>
      {#if task.inProgress}<Glyph name="pause" size={10} />{:else}<span class="dot">·</span>{/if}
      {task.inProgress ? 'in progress' : 'not started'}
    </button>
    <button class="flow" class:active={queuePos !== null} data-testid="task-queue-toggle"
      onclick={() => void (queuePos === null ? app.addToQueue(task.id) : app.removeFromQueue(task.id))}>
      <span class="dot">≡</span>
      {queuePos === null ? 'add to queue' : `in queue · #${queuePos + 1}`}
    </button>
  </div>
  {/if}

  {#if !compact}
  <div class="meta">
    created {fmt(task.createdAt)}{#if task.completedAt}&nbsp;· completed {fmt(task.completedAt)}{/if}
    {#if activeMs(task)}&nbsp;· took {formatElapsed(activeMs(task)!)}{/if}
    {#if template?.completedInstances}
      &nbsp;· averages {formatElapsed(template.avgActiveMs ?? 0)} over {template.completedInstances}
    {/if}
  </div>

  <div class="actions">
    <button class="danger" class:armed={deleteArmed} data-testid="task-delete-{task.id}" onclick={remove}>
      {deleteArmed ? 'tap again to delete' : 'delete'}
    </button>
    <button data-testid="task-collapse" onclick={() => { flush(); oncollapse(); }}>done</button>
  </div>
  {/if}
</div>

<style>
  .editor {
    display: flex; flex-direction: column; gap: 12px; padding: 4px 2px 8px;
    /* The fields grid measures THIS box, not the viewport (see .fields). */
    container: editor / inline-size;
  }
  .notes {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-size: 0.85rem; padding: 8px; outline: none;
    font-family: var(--font-sans);
    /* autogrow owns the height (always tall enough for the whole text, never
       an inner scroller); a floor keeps an EMPTY field from collapsing to one
       line, and manual resize would only fight the action. */
    min-height: 3.4rem; resize: none;
  }
  .notes:focus { color: var(--text); border-color: var(--acc-blue); }
  .move { display: flex; align-items: center; gap: 8px; }
  .move span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .move select {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 6px 8px; font-size: 0.82rem;
  }
  /* Grid, not a flex row: a native date input has a wide intrinsic minimum and
     refuses to shrink past it, so three across would overlap on a phone. This
     drops to two columns (then one) before that can happen. */
  /*
   * One field per row by default, side by side only when there is real room.
   *
   * auto-fit with a 150px minimum was not enough: Safari gives date and time
   * inputs an intrinsic minimum width that ignores `width: 100%`, and the 16px
   * font these get on touch (see app.css — it stops iOS zooming on focus) makes
   * them wider still, so two columns kept colliding on a phone even though the
   * grid said they fit. A width query on the editor itself is the honest
   * measure, since this sits inside a row with its own padding — a viewport
   * query would be describing the wrong box.
   */
  .fields { display: grid; gap: 10px 12px; grid-template-columns: 1fr; }
  @container editor (min-width: 460px) {
    .fields { grid-template-columns: repeat(3, 1fr); }
  }
  .fields label { min-width: 0; display: flex; flex-direction: column; gap: 4px; }
  .fields span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .fields input {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 7px 8px; font-size: 0.85rem; outline: none;
    color-scheme: dark; width: 100%;
    /* NB: no `min-width: 0` here. It used to be, to let the native date control
       shrink — but it outranks the global date/time rule in app.css, which now
       sets a deliberate floor so an empty field isn't a stub. That rule handles
       both ends; this one must not quietly flatten the floor. */
  }
  .repeat-row {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem;
    border: 1px dashed var(--line); border-radius: 6px; padding: 8px;
    background: none; cursor: pointer; text-align: left;
  }
  @media (hover: hover) { .repeat-row:hover { color: var(--acc-cyan); border-color: var(--acc-cyan); } }
  .repeat-row.linked { color: var(--acc-cyan); border-style: solid; }
  .repeat-row.snoozed { color: var(--acc-purple); border-color: var(--acc-purple); }
  .ritual-editor {
    display: flex; flex-direction: column; gap: 8px;
    border: 1px solid var(--acc-cyan); border-radius: 6px; padding: 10px;
  }
  .ritual-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: end; }
  /* The ✕ column exists only when a window can be removed: even an EMPTY auto
     track costs its grid gap, which was the 6px that overflowed a 320px phone. */
  .ritual-row.has-drop { grid-template-columns: 1fr 1fr auto; }
  .ritual-row label { display: flex; flex-direction: column; gap: 4px; }
  .ritual-row span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .ritual-row input {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 7px 8px; font-size: 0.85rem; outline: none;
    color-scheme: dark; width: 100%;
  }
  .days { display: flex; gap: 4px; }
  .day {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; padding: 6px 0; cursor: pointer;
  }
  .day.on { color: var(--acc-green); border-color: var(--acc-green); }
  .ritual-note { color: var(--dim); font-size: 0.72rem; line-height: 1.5; margin: 0; }
  .ritual-window { display: flex; flex-direction: column; gap: 8px; }
  .ritual-window + .ritual-window { border-top: 1px dashed var(--line); padding-top: 10px; }
  .win-drop {
    align-self: flex-end; background: none; border: none; color: var(--dim);
    cursor: pointer; font-size: 0.8rem; padding: 4px 6px;
  }
  @media (hover: hover) { .win-drop:hover { color: var(--acc-magenta); } }
  .win-add {
    align-self: flex-start; background: none; border: 1px dashed var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 5px 10px; cursor: pointer;
  }
  @media (hover: hover) { .win-add:hover { color: var(--acc-cyan); border-color: var(--acc-cyan); } }
  .each {
    display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap;
    color: var(--text); font-size: 0.78rem; cursor: pointer;
  }
  .each input { accent-color: var(--acc-cyan); }
  .each-hint { color: var(--dim); font-size: 0.72rem; }
  .ritual-actions { display: flex; gap: 8px; }
  .ritual-actions button {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.75rem;
    padding: 5px 12px; cursor: pointer;
  }
  .ritual-actions .drop { color: var(--acc-magenta); margin-left: auto; }
  /* Wraps: three buttons ("make current / in progress / add to queue") run
     6px past a 320px phone if forced onto one line. */
  .flow-row { display: flex; flex-wrap: wrap; gap: 8px; }
  .flow {
    flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem;
    padding: 8px; cursor: pointer;
  }
  .flow .dot { line-height: 1; }
  @media (hover: hover) { .flow:hover { color: var(--text); } }
  .flow.active { color: var(--acc-cyan); border-color: var(--acc-cyan); }
  .meta { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .actions { display: flex; justify-content: space-between; }
  .actions button {
    background: none; border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.8rem;
    padding: 6px 16px; cursor: pointer;
  }
  @media (hover: hover) { .actions button:hover { background: var(--bg2); } }
  .danger { color: var(--acc-magenta); }
  .danger.armed { background: var(--acc-magenta); color: var(--bg0); font-weight: 700; }
</style>
