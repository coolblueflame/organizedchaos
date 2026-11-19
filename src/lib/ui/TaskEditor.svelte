<!--
  Expanded task editor (spec §6): unlabeled name + notes on top, then priority,
  tags, deadline, estimate. Recurrence editor arrives in Phase 4 (placeholder row).
  Text fields save on debounce + blur; discrete fields save immediately.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { pickerListGroups } from '../domain/listOrder';
  import { formatEstimate } from '../domain/estimate';
  import { describeRitualTask, isRitualTask, ritualPatch, ritualWindows } from '../domain/ritual';
  import RitualEditor from './RitualEditor.svelte';
  import type { HoursRule } from '../domain/schedule';
  import { navigate } from './router.svelte';
  import type { Task } from '../domain/types';
  import PrioritySelect from './PrioritySelect.svelte';
  import TagPicker from './TagPicker.svelte';
  import BlockedBy from './BlockedBy.svelte';
  import RecurrenceEditor from './RecurrenceEditor.svelte';
  import { describeRecurrence } from './recurrenceText';
  import { skipKind } from '../domain/skip';
  import { appDayKey } from '../domain/time';
  import { activeMs, formatElapsed } from '../domain/stats';
  import { liveQueueIds } from '../domain/dayQueue';
  import Checklist from './Checklist.svelte';
  import type { RecurrenceMode } from '../domain/types';
  import Glyph from './Glyph.svelte';
  import { autogrow } from './autogrow';
  import EstimateField from './EstimateField.svelte';
  import LinkChips from './LinkChips.svelte';

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
    commitDeadline();
  }

  /*
    The deadline commits when you LEAVE the field, never mid-choice. On iOS,
    opening the picker on an empty field writes today's date into it at
    once; saving that re-sorts the list, which remounts this row and closes
    the picker under your finger, and choosing the real date takes a second
    trip (2026-09-06 report). Desktop typing has the same shape: each valid
    keystroke used to re-sort. Every way out of the editor commits the draft
    — blur, the collapse button's flush, the outside-tap and Escape paths
    (both blur first) — so nothing is lost, it just waits until you are done.
  */
  let deadlineDraft = $state<string | null>(null);

  function commitDeadline() {
    if (deadlineDraft === null) return;
    const value = deadlineDraft || undefined;
    deadlineDraft = null;
    if (value === task.deadline) return;
    void app.patchTask(task.id, { deadline: value });
    touched();
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
  let ritualOpen = $state(false);

  async function saveRitual(windows: HoursRule[], perWindow: boolean) {
    await app.patchTask(task.id, ritualPatch(windows, perWindow));
    touched();
    ritualOpen = false;
  }

  async function removeRitual() {
    await app.patchTask(task.id, {
      ritual: undefined, rituals: undefined, ritualPerWindow: undefined,
      ritualDoneDay: undefined, ritualDoneSlots: undefined, ritualSkips: undefined,
    });
    ritualOpen = false;
  }

  const template = $derived(task.recurrenceId
    ? app.state.templates.find((t) => t.id === task.recurrenceId && !t.deleted)
    : undefined);

  /**
   * Where this instance has drifted from its rule (2026-08-11, the walk that
   * respawned Medium after being bumped to MAX): every spawn is born from
   * the RULE, so an instance-only edit quietly reverts next time. Priority,
   * estimate and name; notes are left alone, because a note is where the
   * per-occurrence detail belongs. A rename is offered rather than pushed
   * through: an instance called "walk (rainy route)" is a fair one-off, and
   * the rule should only follow it on a deliberate tap. An empty name is
   * mid-typing, not drift.
   */
  const ruleDrift = $derived.by(() => {
    if (!template) return [] as string[];
    const drift: string[] = [];
    if (template.priority !== task.priority) drift.push(template.priority);
    if (template.estimateHours !== task.estimateHours) {
      drift.push(template.estimateHours === undefined ? 'no estimate' : formatEstimate(template.estimateHours));
    }
    const name = task.name.trim();
    const ruleName = template.name.trim();
    if (name !== '' && ruleName !== name) drift.push(ruleName === '' ? 'no name' : `“${ruleName}”`);
    return drift;
  });

  function adoptIntoRule() {
    if (!template) return;
    const name = task.name.trim();
    void app.updateRecurring(template.id, {
      priority: task.priority,
      estimateHours: task.estimateHours,
      ...(name !== '' ? { name } : {}),
    });
  }

  async function saveRecurrence(mode: RecurrenceMode, deadlineOffsetDays?: number) {
    let tplId: string;
    if (template) {
      tplId = template.id;
      await app.updateRecurring(tplId, { mode, deadlineOffsetDays });
    } else {
      tplId = (await app.createRecurring(task.id, mode, deadlineOffsetDays)).id;
    }
    touched();
    recurOpen = false;
    // Last: a start day still ahead takes this very task out of the list.
    await app.setAsideUntilStart(tplId);
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
  <!-- A textarea can't carry an anchor, so any URL in the notes gets a
       tappable chip right below it (2026-08-20 ask). -->
  <LinkChips {notes} testid="task-links-{task.id}" />
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
      <!-- Drafted on input/change, committed on blur (see commitDeadline):
           saving mid-choice re-sorts the list and remounts this row. -->
      <!-- .empty: desktop Safari ghosts today's date into valueless date
           inputs; the app.css rule hides that until a real value lands -->
      <input type="date" data-testid="task-deadline-input" value={task.deadline ?? ''}
        class:empty={!task.deadline}
        oninput={(e) => (deadlineDraft = e.currentTarget.value)}
        onchange={(e) => (deadlineDraft = e.currentTarget.value)}
        onblur={commitDeadline} />
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
      {#if template}↻ {describeRecurrence(template.mode, template.deadlineOffsetDays, appDayKey(new Date(), app.state.settings.rolloverHour))}{#if template.paused}&nbsp;(paused){/if}
      {:else}↻ make recurring{/if}
    </button>
    {#if ruleDrift.length > 0}
      <!-- The next spawn is born from the RULE — say so before it surprises. -->
      <div class="rule-drift" data-testid="rule-drift">
        <span>the rule still says <b>{ruleDrift.join(' · ')}</b> — future spawns follow it</span>
        <button data-testid="rule-adopt" onclick={adoptIntoRule}>make the rule match</button>
      </div>
    {/if}
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
    <RitualEditor initial={ritualWindows(task)} perWindow={task.ritualPerWindow === true}
      onsave={(w, each) => void saveRitual(w, each)}
      oncancel={() => (ritualOpen = false)}
      onremove={isRitualTask(task) ? () => void removeRitual() : undefined} />
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
    {#if skipKind(task, app.state.templates, new Date(), app.state.settings.rolloverHour)}
      <button class="flow" data-testid="task-skip-round" title="skip until its next time, without counting it as done"
        onclick={() => { flush(); void app.skipRound(task.id); }}>
        <span class="dot">↷</span> skip round
      </button>
    {/if}
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
    <button data-testid="task-collapse" onclick={() => { flush(); oncollapse(); }}>done editing</button>
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
  .rule-drift {
    display: flex; align-items: center; gap: 8px; flex-wrap: wrap;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    padding: 2px 2px 0;
  }
  .rule-drift b { color: var(--acc-orange); font-weight: 600; }
  .rule-drift button {
    background: none; border: 1px solid var(--line); border-radius: 5px;
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.68rem;
    padding: 3px 8px; cursor: pointer;
  }
  @media (hover: hover) { .rule-drift button:hover { border-color: var(--acc-cyan); } }
  .repeat-row.snoozed { color: var(--acc-purple); border-color: var(--acc-purple); }
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
  .actions { display: flex; justify-content: space-between; gap: 8px; }
  /* The armed delete label is long; it wraps, and this one keeps its line. */
  .actions button[data-testid="task-collapse"] { white-space: nowrap; }
  .actions button {
    background: none; border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.8rem;
    padding: 6px 16px; cursor: pointer;
  }
  @media (hover: hover) { .actions button:hover { background: var(--bg2); } }
  .danger { color: var(--acc-magenta); }
  .danger.armed { background: var(--acc-magenta); color: var(--bg0); font-weight: 700; }
</style>
