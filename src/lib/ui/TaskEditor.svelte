<!--
  Expanded task editor (spec §6): unlabeled name + notes on top, then priority,
  tags, deadline, estimate. Recurrence editor arrives in Phase 4 (placeholder row).
  Text fields save on debounce + blur; discrete fields save immediately.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import type { Task } from '../domain/types';
  import PrioritySelect from './PrioritySelect.svelte';
  import TagPicker from './TagPicker.svelte';
  import BlockedBy from './BlockedBy.svelte';
  import RecurrenceEditor from './RecurrenceEditor.svelte';
  import { describeRecurrence } from './recurrenceText';
  import { activeMs, formatElapsed } from '../domain/stats';
  import type { RecurrenceMode } from '../domain/types';

  let { task, oncollapse, compact = false }: {
    task: Task;
    oncollapse: () => void;
    /** Quick add supplies its own buttons — hide the row-editor's own controls. */
    compact?: boolean;
  } = $props();

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

  function setEstimate(value: string) {
    const hours = parseFloat(value);
    void app.patchTask(task.id, { estimateHours: hours > 0 ? hours : undefined });
    touched();
  }

  // Same two-stage arming as the row's delete — a mis-tap in here was deleting
  // immediately, which is exactly the friction this was supposed to add.
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
    flush();
    void app.removeTask(task.id); // the store records the undo
  }

  const fmt = (ts: number) => new Date(ts).toLocaleDateString();

  // ── recurrence ─────────────────────────────────────────────────────────
  let recurOpen = $state(false);
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
    rows="2" bind:value={notes} oninput={queueSave} onblur={flush}></textarea>

  <PrioritySelect value={task.priority}
    onchange={(p) => { void app.patchTask(task.id, { priority: p }); touched(); }} />

  <TagPicker selected={task.tagIds} ontoggle={toggleTag} />

  <label class="move">
    <span>list</span>
    <select data-testid="task-move-list" value={task.listId}
      onchange={(e) => { void app.moveTask(task.id, e.currentTarget.value); touched(); }}>
      {#each app.state.lists as l (l.id)}
        <option value={l.id}>{l.title}</option>
      {/each}
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
      <span>estimate (h)</span>
      <input type="number" data-testid="task-estimate-input" min="0.5" step="0.5"
        value={task.estimateHours ?? ''} placeholder="1"
        oninput={(e) => setEstimate(e.currentTarget.value)}
        onchange={(e) => setEstimate(e.currentTarget.value)} />
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

  {#if !compact}
  <div class="flow-row">
    <button class="flow" data-testid="task-make-current"
      onclick={() => { flush(); void app.acceptTask(task.id).then(() => navigate({ name: 'home' })); }}>
      ▶ make current
    </button>
    <button class="flow" class:active={task.inProgress} data-testid="task-inprogress-toggle"
      onclick={() => void app.setInProgress(task.id, !task.inProgress)}>
      {task.inProgress ? '⏸ in progress' : '· not started'}
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
  .editor { display: flex; flex-direction: column; gap: 12px; padding: 4px 2px 8px; }
  .notes {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-size: 0.85rem; padding: 8px; outline: none; resize: vertical;
    font-family: var(--font-sans);
  }
  .notes:focus { color: var(--text); border-color: var(--acc-blue); }
  .move { display: flex; align-items: center; gap: 8px; }
  .move span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .move select {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 6px 8px; font-size: 0.82rem;
  }
  .fields { display: flex; gap: 12px; }
  .fields label { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .fields span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .fields input {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 7px 8px; font-size: 0.85rem; outline: none;
    color-scheme: dark; width: 100%;
  }
  .repeat-row {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem;
    border: 1px dashed var(--line); border-radius: 6px; padding: 8px;
    background: none; cursor: pointer; text-align: left;
  }
  .repeat-row:hover { color: var(--acc-cyan); border-color: var(--acc-cyan); }
  .repeat-row.linked { color: var(--acc-cyan); border-style: solid; }
  .flow-row { display: flex; gap: 8px; }
  .flow {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem;
    padding: 8px; cursor: pointer;
  }
  .flow:hover { color: var(--text); }
  .flow.active { color: var(--acc-cyan); border-color: var(--acc-cyan); }
  .meta { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .actions { display: flex; justify-content: space-between; }
  .actions button {
    background: none; border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.8rem;
    padding: 6px 16px; cursor: pointer;
  }
  .actions button:hover { background: var(--bg2); }
  .danger { color: var(--acc-magenta); }
  .danger.armed { background: var(--acc-magenta); color: var(--bg0); font-weight: 700; }
</style>
