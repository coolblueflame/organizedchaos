<!--
  The interactive face of a notes-borne checklist (see domain/checklist.ts).
  Renders only the checkbox LINES — the prose around them stays wherever the
  notes are displayed. Ticking hands the line index back to the owner, who
  writes the flipped text through its own save path.
-->
<script lang="ts">
  import { checklistItems } from '../domain/checklist';
  import Glyph from './Glyph.svelte';

  let { notes, taskId, ontoggle }: {
    notes: string;
    /** For stable per-item testids only. */
    taskId: string;
    ontoggle: (line: number) => void;
  } = $props();

  const items = $derived(checklistItems(notes));
</script>

{#if items.length > 0}
  <ul class="checklist" data-testid="checklist-{taskId}">
    {#each items as item (item.line)}
      <li>
        <button class="item" class:done={item.done}
          data-testid="check-item-{taskId}-{item.line}"
          onclick={() => ontoggle(item.line)}
          aria-pressed={item.done}>
          <Glyph name={item.done ? 'box-checked' : 'box'} size={14} />
          <span class="text">{item.text || '…'}</span>
        </button>
      </li>
    {/each}
  </ul>
{/if}

<style>
  .checklist { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
  .item {
    display: flex; align-items: baseline; gap: 8px; width: 100%;
    background: none; border: none; padding: 4px 2px; cursor: pointer;
    color: var(--text); font-size: 0.85rem; text-align: left; line-height: 1.4;
  }
  .item :global(svg) { flex: none; transform: translateY(2px); color: var(--dim); }
  .item.done :global(svg) { color: var(--acc-green); }
  .item.done .text { color: var(--dim); text-decoration: line-through; text-decoration-color: color-mix(in srgb, var(--dim) 60%, transparent); }
  @media (hover: hover) { .item:hover .text { color: var(--acc-cyan); } .item.done:hover .text { color: var(--dim); } }
  .text { overflow-wrap: anywhere; }
</style>
