<!--
  Tags on a task.

  Shows what the task actually wears, and nothing else, behind a + that opens a
  filter box. Laying every tag out as a chip was fine at a dozen and useless at
  a hundred and twenty — the detail card became mostly other people's tags.

  Typing filters what exists; Enter takes the exact match if there is one and
  creates the tag if there isn't, so adding a tag and reusing a tag are the same
  gesture and neither needs a decision up front.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { tagColor, TAG_COLORS } from './tagColors';
  import { tagKey } from '../domain/tags';

  let { selected, ontoggle }: { selected: string[]; ontoggle: (tagId: string) => void } = $props();

  let adding = $state(false);
  let query = $state('');
  let inputEl = $state<HTMLInputElement | null>(null);

  /**
   * A colour for a tag made here, chosen rather than asked for: the palette took
   * up more of the card than everything else combined, and picking a colour is
   * not what someone mid-thought about a task wants to be doing. The least-used
   * one keeps them spread out, and the tags screen can recolour any of them.
   */
  const nextColor = $derived.by(() => {
    const used = new Array<number>(TAG_COLORS.length).fill(0);
    for (const tag of app.state.tags) {
      const i = tag.colorIndex % TAG_COLORS.length;
      used[i] = (used[i] ?? 0) + 1;
    }
    return used.indexOf(Math.min(...used));
  });

  /** Enough to choose from; few enough that the card stays a card. */
  const SUGGESTION_LIMIT = 8;

  const attached = $derived(
    selected
      .map((id) => app.state.tags.find((t) => t.id === id))
      .filter((t) => t !== undefined),
  );

  const suggestions = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return app.state.tags
      .filter((t) => !selected.includes(t.id) && (q === '' || t.name.toLowerCase().includes(q)))
      .slice(0, SUGGESTION_LIMIT);
  });

  /** An existing tag by the same name, however it was capitalised. */
  const exact = $derived.by(() => {
    const key = tagKey(query);
    return key ? app.state.tags.find((t) => tagKey(t.name) === key) : undefined;
  });

  function open() {
    adding = true;
    query = '';
    queueMicrotask(() => inputEl?.focus());
  }

  function close() {
    adding = false;
    query = '';
  }

  /** Enter: use the tag of that name, or make it. */
  async function commit() {
    const name = query.trim();
    if (!name) { close(); return; }
    if (exact) {
      if (!selected.includes(exact.id)) ontoggle(exact.id);
    } else {
      const tag = await app.addTag(name, nextColor);
      ontoggle(tag.id);
    }
    // Stay open: adding two tags in a row is the common case.
    query = '';
    inputEl?.focus();
  }

  function pick(id: string) {
    ontoggle(id);
    query = '';
    inputEl?.focus();
  }
</script>

<div class="picker">
  <div class="attached">
    {#each attached as tag (tag.id)}
      <!-- The chip IS the remove control; the ✕ is decoration so the button
           still reads as just the tag's name. -->
      <button
        class="chip on"
        style="--c: {tagColor(tag.colorIndex)}"
        data-testid="tag-chip-{tag.id}"
        title="remove {tag.name}"
        onclick={() => ontoggle(tag.id)}>
        <span class="dot"></span><span class="chip-name">{tag.name}</span><span class="x" aria-hidden="true">✕</span>
      </button>
    {/each}

    {#if !adding}
      <button class="chip new" data-testid="new-tag" onclick={open}>+ tag</button>
    {/if}
  </div>

  {#if adding}
    <div class="add">
      <input
        bind:this={inputEl}
        bind:value={query}
        data-testid="new-tag-input"
        placeholder="find or create a tag…"
        onkeydown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); void commit(); }
          if (e.key === 'Escape') { e.preventDefault(); close(); }
        }} />

      {#if suggestions.length > 0}
        <div class="suggestions">
          {#each suggestions as tag (tag.id)}
            <!-- A distinct testid from the attached chips: the same tag can be
                 in both places across a single interaction, and one id for both
                 makes every query about tags ambiguous. -->
            <button class="chip" style="--c: {tagColor(tag.colorIndex)}"
              data-testid="tag-suggest-{tag.id}" onclick={() => pick(tag.id)}>
              <span class="dot"></span><span class="chip-name">{tag.name}</span>
            </button>
          {/each}
        </div>
      {/if}

      {#if query.trim() && !exact}
        <span class="hint">
          <span class="swatch-dot" style="background: {tagColor(nextColor)}"></span>
          ↵ creates “{query.trim()}”
        </span>
      {:else if query.trim() && exact && selected.includes(exact.id)}
        <span class="hint">“{exact.name}” is already on this task</span>
      {/if}

      <div class="add-actions">
        <button class="add-btn" data-testid="new-tag-save" onclick={() => void commit()}>add</button>
        <button class="done-btn" data-testid="new-tag-done" onclick={close}>done</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .picker { display: flex; flex-direction: column; gap: 8px; }
  .attached { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 999px;
    color: var(--dim); font-size: 0.75rem; padding: 4px 10px; cursor: pointer;
    /* A chip must never outgrow the card: an imported library has tag names of
       arbitrary length, and one wide chip pokes past the editor's border. The
       name ellipsizes; the dot and ✕ stay. */
    max-width: 100%; min-width: 0;
  }
  .chip-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; min-width: 0; }
  .chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); opacity: 0.5; }
  .chip.on { color: var(--text); border-color: var(--c); }
  .chip.on .dot { opacity: 1; }
  .chip .x { color: var(--dim); font-size: 0.7rem; margin-left: 2px; }
  .chip.on:hover .x { color: var(--acc-magenta); }
  .chip.new { color: var(--dim); border-style: dashed; }
  .chip.new:hover { color: var(--acc-green); border-color: var(--acc-green); }
  .add { display: flex; flex-direction: column; gap: 6px; }
  .add input {
    background: var(--bg2); border: 1px solid var(--acc-blue); border-radius: 6px;
    color: var(--text); padding: 6px 10px; font-size: 0.8rem; outline: none;
    width: 100%; min-width: 0; max-width: 100%;
  }
  /* Suggestions scroll rather than growing the card without limit. */
  .suggestions { display: flex; flex-wrap: wrap; gap: 6px; max-height: 96px; overflow-y: auto; }
  .hint {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    display: inline-flex; align-items: center; gap: 6px;
  }
  .swatch-dot { width: 8px; height: 8px; border-radius: 50%; }
  .add-actions { display: flex; gap: 8px; }
  .add-btn, .done-btn {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    font-family: var(--font-mono); font-size: 0.75rem; padding: 4px 12px; cursor: pointer;
  }
  .add-btn { color: var(--acc-green); }
  .done-btn { color: var(--dim); }
</style>
