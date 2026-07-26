<script lang="ts">
  import { app } from '../state/app.svelte';
  import { tagColor, TAG_COLORS } from './tagColors';

  let { selected, ontoggle }: { selected: string[]; ontoggle: (tagId: string) => void } = $props();

  let creating = $state(false);
  let newName = $state('');
  let newColor = $state(0);

  async function create() {
    const name = newName.trim();
    if (!name) { creating = false; return; }
    const tag = await app.addTag(name, newColor);
    ontoggle(tag.id); // newly created tag starts selected
    newName = '';
    creating = false;
  }
</script>

<div class="picker">
  {#each app.state.tags as tag (tag.id)}
    <button
      class="chip"
      class:on={selected.includes(tag.id)}
      style="--c: {tagColor(tag.colorIndex)}"
      data-testid="tag-chip-{tag.id}"
      onclick={() => ontoggle(tag.id)}>
      <span class="dot"></span>{tag.name}
    </button>
  {/each}

  {#if creating}
    <div class="create">
      <!-- svelte-ignore a11y_autofocus -->
      <input autofocus bind:value={newName} placeholder="tag name" data-testid="new-tag-input"
        onkeydown={(e) => { if (e.key === 'Enter') create(); if (e.key === 'Escape') creating = false; }} />
      <div class="swatch">
        {#each TAG_COLORS as c, i (c)}
          <button class="color" class:sel={newColor === i} style="background: {c}"
            aria-label="color {i}" onclick={() => (newColor = i)}></button>
        {/each}
      </div>
      <button class="add" data-testid="new-tag-save" onclick={create}>add</button>
    </div>
  {:else}
    <button class="chip new" data-testid="new-tag" onclick={() => (creating = true)}>+ tag</button>
  {/if}
</div>

<style>
  .picker { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 999px;
    color: var(--dim); font-size: 0.75rem; padding: 4px 10px; cursor: pointer;
  }
  .chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); opacity: 0.5; }
  .chip.on { color: var(--text); border-color: var(--c); }
  .chip.on .dot { opacity: 1; }
  .chip.new { color: var(--dim); border-style: dashed; }
  .chip.new:hover { color: var(--acc-green); border-color: var(--acc-green); }
  .create { display: flex; flex-direction: column; gap: 6px; width: 100%; }
  .create input {
    background: var(--bg2); border: 1px solid var(--acc-blue); border-radius: 6px;
    color: var(--text); padding: 6px 10px; font-size: 0.8rem; outline: none;
  }
  .swatch { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; }
  .color { aspect-ratio: 1; border: 2px solid transparent; border-radius: 6px; cursor: pointer; }
  .color.sel { border-color: var(--text); }
  .add {
    align-self: flex-start; background: var(--bg2); border: 1px solid var(--line);
    border-radius: 6px; color: var(--acc-green); font-family: var(--font-mono);
    font-size: 0.75rem; padding: 4px 12px; cursor: pointer;
  }
</style>
