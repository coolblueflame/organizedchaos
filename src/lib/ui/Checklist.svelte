<!--
  The interactive face of a notes-borne checklist (see domain/checklist.ts).
  Renders only the checkbox LINES — the prose around them stays wherever the
  notes are displayed. The widget owns the whole interaction now: ticking,
  tap-the-text renaming, and (where allowed) adding — every change reported to
  the owner as the complete new notes text, written through its own save path.
-->
<script lang="ts">
  import {
    appendChecklistItem, checklistItems, removeChecklistLine, renameChecklistLine,
    toggleChecklistLine,
  } from '../domain/checklist';
  import Glyph from './Glyph.svelte';
  import { focusOnMount } from './focusOnMount';
  import { app } from '../state/app.svelte';

  let { notes, taskId, onchange, allowAdd = false }: {
    notes: string;
    /** For stable per-item testids only. */
    taskId: string;
    onchange: (notes: string) => void;
    /** Show the "checklist item" button (the editor wants it; cards may not). */
    allowAdd?: boolean;
  } = $props();

  const items = $derived(checklistItems(notes));

  let editingLine = $state<number | null>(null);
  let draft = $state('');

  function startEdit(line: number, text: string) {
    editingLine = line;
    draft = text;
  }

  /**
   * Saving an empty text DELETES the item — which is also what quietly cleans
   * up an added-then-abandoned "- [ ] " line. `viaEnter` chains the next item
   * when the last one was just named (the app-wide rapid-entry convention);
   * Enter on an empty item ends the chain, exactly like task entry does.
   */
  function saveEdit(viaEnter = false) {
    // Escape clears the state and the input's teardown blur still fires —
    // the same guard every inline editor in this app has learned to carry.
    if (editingLine === null) return;
    const line = editingLine;
    editingLine = null;
    const text = draft.trim();
    const next = text ? renameChecklistLine(notes, line, text) : removeChecklistLine(notes, line);
    if (next !== notes) onchange(next);
    const wasLast = items.length > 0 && line === items[items.length - 1]!.line;
    if (viaEnter && text && wasLast && allowAdd) addItem(next);
  }

  /** Escape: back out — and an item that never had text tidies itself away. */
  function cancelEdit() {
    if (editingLine === null) return;
    const line = editingLine;
    editingLine = null;
    const item = items.find((i) => i.line === line);
    if (item && item.text === '') onchange(removeChecklistLine(notes, line));
  }

  function addItem(base = notes) {
    const next = appendChecklistItem(base);
    onchange(next);
    startEdit(next.split('\n').length - 1, '');
  }
</script>

{#if items.length > 0 || allowAdd}
  <div class="checklist-wrap">
    {#if items.length > 0}
      <ul class="checklist" data-testid="checklist-{taskId}">
        {#each items as item (item.line)}
          <li>
            <button class="tick" class:done={item.done}
              data-testid="check-item-{taskId}-{item.line}"
              onclick={() => {
                onchange(toggleChecklistLine(notes, item.line));
                // Only completing a step gets a voice — unticking is a correction.
                if (!item.done) app.fireEgg('checklistTicked');
              }}
              aria-pressed={item.done} aria-label="toggle">
              <Glyph name={item.done ? 'box-checked' : 'box'} size={14} />
            </button>
            {#if editingLine === item.line}
              <!-- CAPTURE phase, not onkeydown: Svelte 5 delegates keydown to the
                   app root, so a bubble-phase stopPropagation cannot beat the
                   document-level Escape that collapses the whole task editor. -->
              <input class="edit" data-testid="check-edit-{taskId}-{item.line}" use:focusOnMount
                bind:value={draft}
                onblur={() => {
                  // Only save if this session is still OURS: chaining to the
                  // next item unmounts this input, and its teardown blur would
                  // otherwise land on the fresh session and delete it.
                  if (editingLine === item.line) saveEdit();
                }}
                onkeydowncapture={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); saveEdit(true); }
                  if (e.key === 'Escape') { e.stopPropagation(); cancelEdit(); }
                }} />
            {:else}
              <button class="text" class:done={item.done}
                data-testid="check-text-{taskId}-{item.line}"
                onclick={() => startEdit(item.line, item.text)}
                title="tap to rename">{item.text || '…'}</button>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if allowAdd}
      <button class="add-check" data-testid="task-add-checklist" onclick={() => addItem()}>
        <Glyph name="box" size={11} /> checklist item
      </button>
    {/if}
  </div>
{/if}

<style>
  .checklist-wrap { display: flex; flex-direction: column; gap: 4px; align-items: flex-start; }
  .checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; width: 100%; }
  li { display: flex; align-items: baseline; gap: 8px; padding: 3px 2px; }
  .tick {
    flex: none; background: none; border: none; padding: 2px; cursor: pointer;
    color: var(--dim); transform: translateY(2px);
  }
  .tick.done { color: var(--acc-green); }
  .text {
    flex: 1; min-width: 0; background: none; border: none; padding: 0;
    color: var(--text); font-size: 0.85rem; text-align: left; line-height: 1.4;
    cursor: text; overflow-wrap: anywhere;
  }
  .text.done { color: var(--dim); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--dim) 60%, transparent); }
  @media (hover: hover) { .text:hover { color: var(--acc-cyan); } .text.done:hover { color: var(--dim); } }
  .edit {
    flex: 1; min-width: 0;
    background: var(--bg2); border: 1px solid var(--acc-cyan); border-radius: 6px;
    color: var(--text); font-size: 0.85rem; padding: 3px 8px;
  }
  .add-check {
    display: inline-flex; align-items: center; gap: 5px;
    background: none; border: 1px dashed var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    padding: 4px 9px; cursor: pointer;
  }
  @media (hover: hover) { .add-check:hover { color: var(--acc-cyan); border-color: var(--acc-cyan); } }
</style>
