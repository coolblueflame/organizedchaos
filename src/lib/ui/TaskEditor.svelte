<!--
  Expanded task editor (spec §6): unlabeled name + notes on top, then priority,
  tags, deadline, estimate. Recurrence editor arrives in Phase 4 (placeholder row).
  Text fields save on debounce + blur; discrete fields save immediately.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { toast } from './toast.svelte';
  import { navigate } from './router.svelte';
  import type { Task } from '../domain/types';
  import PrioritySelect from './PrioritySelect.svelte';
  import TagPicker from './TagPicker.svelte';

  let { task, oncollapse }: { task: Task; oncollapse: () => void } = $props();

  // Draft copies are intentional: the editor owns text-field state while typing
  // and flushes on debounce/blur. Safe because each task gets its own editor
  // instance (keyed rows) — the props can never swap tasks under us.
  // svelte-ignore state_referenced_locally
  let name = $state(task.name);
  // svelte-ignore state_referenced_locally
  let notes = $state(task.notes);

  let saveTimer: ReturnType<typeof setTimeout> | undefined;
  function queueSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flush, 400);
  }
  function flush() {
    clearTimeout(saveTimer);
    if (name !== task.name || notes !== task.notes) {
      void app.patchTask(task.id, { name, notes });
    }
  }

  function toggleTag(tagId: string) {
    const tagIds = task.tagIds.includes(tagId)
      ? task.tagIds.filter((id) => id !== tagId)
      : [...task.tagIds, tagId];
    void app.patchTask(task.id, { tagIds });
  }

  function setDeadline(value: string) {
    void app.patchTask(task.id, { deadline: value || undefined });
  }

  function setEstimate(value: string) {
    const hours = parseFloat(value);
    void app.patchTask(task.id, { estimateHours: hours > 0 ? hours : undefined });
  }

  function remove() {
    flush();
    const id = task.id;
    void app.removeTask(id).then(() => toast.show('Task deleted', () => void app.restoreTask(id)));
  }

  const fmt = (ts: number) => new Date(ts).toLocaleDateString();
</script>

<div class="editor">
  <!-- svelte-ignore a11y_autofocus -->
  <input class="name" data-testid="task-name-input" placeholder="task name"
    autofocus={task.name === ''}
    bind:value={name} oninput={queueSave} onblur={flush} />
  <textarea class="notes" data-testid="task-notes-input" placeholder="notes"
    rows="2" bind:value={notes} oninput={queueSave} onblur={flush}></textarea>

  <PrioritySelect value={task.priority} onchange={(p) => void app.patchTask(task.id, { priority: p })} />

  <TagPicker selected={task.tagIds} ontoggle={toggleTag} />

  <div class="fields">
    <label>
      <span>deadline</span>
      <input type="date" data-testid="task-deadline-input" value={task.deadline ?? ''}
        onchange={(e) => setDeadline(e.currentTarget.value)} />
    </label>
    <label>
      <span>estimate (h)</span>
      <input type="number" data-testid="task-estimate-input" min="0.5" step="0.5"
        value={task.estimateHours ?? ''} placeholder="1"
        onchange={(e) => setEstimate(e.currentTarget.value)} />
    </label>
  </div>

  <div class="repeat-placeholder">↻ recurring — coming soon</div>

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

  <div class="meta">
    created {fmt(task.createdAt)}{#if task.completedAt}&nbsp;· completed {fmt(task.completedAt)}{/if}
  </div>

  <div class="actions">
    <button class="danger" data-testid="task-delete-{task.id}" onclick={remove}>delete</button>
    <button data-testid="task-collapse" onclick={() => { flush(); oncollapse(); }}>done</button>
  </div>
</div>

<style>
  .editor { display: flex; flex-direction: column; gap: 12px; padding: 4px 2px 8px; }
  .name {
    background: none; border: none; border-bottom: 1px solid var(--line);
    color: var(--text); font-size: 1rem; font-weight: 500; padding: 6px 2px; outline: none;
  }
  .name:focus { border-bottom-color: var(--acc-blue); }
  .notes {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-size: 0.85rem; padding: 8px; outline: none; resize: vertical;
    font-family: var(--font-sans);
  }
  .notes:focus { color: var(--text); border-color: var(--acc-blue); }
  .fields { display: flex; gap: 12px; }
  .fields label { flex: 1; display: flex; flex-direction: column; gap: 4px; }
  .fields span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .fields input {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 7px 8px; font-size: 0.85rem; outline: none;
    color-scheme: dark; width: 100%;
  }
  .repeat-placeholder {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem;
    border: 1px dashed var(--line); border-radius: 6px; padding: 8px; opacity: 0.6;
  }
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
</style>
