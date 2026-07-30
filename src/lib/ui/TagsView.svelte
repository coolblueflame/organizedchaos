<!--
  Tag housekeeping (#/tags).

  An imported library arrives with every tag it ever had, so this screen is
  built for pruning rather than browsing: how many tasks each tag is actually
  carrying, which ones are the same tag spelled two ways, and which are dead
  weight — with the destructive actions all undoable.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { focusOnMount } from './focusOnMount';
  import { duplicateGroups, sortByUsage, tagUsage } from '../domain/tags';
  import { navigate } from './router.svelte';
  import { tagColor, TAG_COLORS } from './tagColors';
  import type { Tag } from '../domain/types';

  const usage = $derived(tagUsage(app.state.tags, app.state.tasks));
  const ordered = $derived(sortByUsage(app.state.tags, usage));
  const dupes = $derived(duplicateGroups(app.state.tags, usage));
  const unused = $derived(ordered.filter((t) => (usage.get(t.id)?.total ?? 0) === 0));

  /** Which row is open for editing, and in which mode — one at a time. */
  let editing = $state<{ id: string; mode: 'rename' | 'color' | 'merge' } | null>(null);
  let renameDraft = $state('');

  function openRename(tag: Tag) {
    renameDraft = tag.name;
    editing = { id: tag.id, mode: 'rename' };
  }

  function commitRename(tag: Tag) {
    if (renameDraft.trim() && renameDraft.trim() !== tag.name) void app.renameTag(tag.id, renameDraft);
    editing = null;
  }

  function merge(sourceId: string, targetId: string) {
    editing = null;
    if (targetId) void app.mergeTags(sourceId, targetId);
  }

  const countLabel = (id: string) => {
    const u = usage.get(id);
    if (!u || u.total === 0) return 'unused';
    const parts = [];
    if (u.open) parts.push(`${u.open} open`);
    if (u.completed) parts.push(`${u.completed} done`);
    return parts.join(' · ');
  };
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>Tags</h1>
  </header>

  {#if app.state.tags.length === 0}
    <p class="empty">No tags yet — add one from any task.</p>
  {/if}

  {#if dupes.length}
    <section class="group">
      <h2>same tag, two spellings</h2>
      <p class="hint">
        Merging keeps every task that wore either one — they all end up on the tag you keep.
      </p>
      {#each dupes as group (group[0]!.id)}
        <div class="dupe" data-testid="dupe-group-{group[0]!.id}">
          <div class="names">
            {#each group as tag (tag.id)}
              <span class="chip" style="--c: {tagColor(tag.colorIndex)}">
                <span class="dot"></span>{tag.name}
                <em>{countLabel(tag.id)}</em>
              </span>
            {/each}
          </div>
          <button
            class="link"
            data-testid="merge-group-{group[0]!.id}"
            onclick={() => { for (const t of group.slice(1)) merge(t.id, group[0]!.id); }}>
            merge into “{group[0]!.name}” →
          </button>
        </div>
      {/each}
    </section>
  {/if}

  {#if unused.length > 1}
    <section class="group">
      <h2>nothing is using these</h2>
      <p class="hint">{unused.length} tags aren't on a single task, open or completed.</p>
      <button class="danger" data-testid="delete-unused"
        onclick={() => void app.removeTags(unused.map((t) => t.id))}>
        delete all {unused.length} unused tags
      </button>
    </section>
  {/if}

  <section class="group">
    <h2>all tags · {app.state.tags.length}</h2>
    {#each ordered as tag (tag.id)}
      <div class="row" data-testid="tag-row-{tag.id}">
        <button class="swatch" style="--c: {tagColor(tag.colorIndex)}" aria-label="change colour"
          data-testid="tag-color-{tag.id}"
          onclick={() => (editing = editing?.id === tag.id && editing.mode === 'color'
            ? null : { id: tag.id, mode: 'color' })}></button>

        {#if editing?.id === tag.id && editing.mode === 'rename'}
          <input
            use:focusOnMount
            class="rename"
            data-testid="tag-rename-{tag.id}"
            bind:value={renameDraft}
            onblur={() => commitRename(tag)}
            onkeydown={(e) => {
              if (e.key === 'Enter') commitRename(tag);
              if (e.key === 'Escape') editing = null;
            }} />
        {:else}
          <button class="name" data-testid="tag-name-{tag.id}" onclick={() => openRename(tag)}>
            {tag.name || '(unnamed)'}
          </button>
        {/if}

        <span class="count">{countLabel(tag.id)}</span>
        <button class="link" data-testid="tag-merge-{tag.id}"
          onclick={() => (editing = editing?.id === tag.id && editing.mode === 'merge'
            ? null : { id: tag.id, mode: 'merge' })}>merge</button>
        <button class="link danger-text" data-testid="tag-delete-{tag.id}"
          onclick={() => void app.removeTag(tag.id)}>delete</button>
      </div>

      {#if editing?.id === tag.id && editing.mode === 'color'}
        <div class="swatches">
          {#each TAG_COLORS as c, i (c)}
            <button class="color" class:sel={tag.colorIndex === i} style="background: {c}"
              aria-label="colour {i}"
              onclick={() => { void app.recolorTag(tag.id, i); editing = null; }}></button>
          {/each}
        </div>
      {/if}

      {#if editing?.id === tag.id && editing.mode === 'merge'}
        <div class="mergebar">
          <span class="lead">move everything to</span>
          <select data-testid="tag-merge-target-{tag.id}"
            onchange={(e) => merge(tag.id, e.currentTarget.value)}>
            <option value="">choose a tag…</option>
            {#each ordered.filter((t) => t.id !== tag.id) as other (other.id)}
              <option value={other.id}>{other.name}</option>
            {/each}
          </select>
        </div>
      {/if}
    {/each}
  </section>

  <p class="about">Deleting a tag leaves your tasks alone — only the label goes.</p>
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .group {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px;
  }
  h2 {
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.75rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 0;
  }
  .hint, .empty { color: var(--dim); font-size: 0.8rem; margin: 0; line-height: 1.5; }
  .row { display: flex; align-items: center; gap: 8px; }
  .swatch {
    flex: none; width: 12px; height: 12px; border-radius: 50%; padding: 0;
    background: var(--c); border: 1px solid var(--line); cursor: pointer;
  }
  .name {
    flex: 1; min-width: 0; text-align: left; background: none; border: none; padding: 2px 0;
    color: var(--text); font-size: 0.85rem; cursor: text;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .rename {
    flex: 1; min-width: 0; background: var(--bg2); border: 1px solid var(--acc-blue);
    border-radius: 6px; color: var(--text); padding: 4px 8px; font-size: 0.85rem; outline: none;
  }
  .count { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; white-space: nowrap; }
  .link {
    background: none; border: none; color: var(--acc-blue); cursor: pointer;
    font-size: 0.72rem; padding: 2px 4px; text-align: left; text-decoration: underline;
  }
  .danger-text { color: var(--acc-magenta); }
  .swatches { display: grid; grid-template-columns: repeat(8, 1fr); gap: 4px; padding: 2px 0 6px 20px; }
  .color { aspect-ratio: 1; border: 2px solid transparent; border-radius: 6px; cursor: pointer; }
  .color.sel { border-color: var(--text); }
  .mergebar { display: flex; align-items: center; gap: 8px; padding: 0 0 6px 20px; }
  .lead { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; }
  .mergebar select {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 6px; font-size: 0.8rem; outline: none; flex: 1; min-width: 0;
  }
  .dupe { display: flex; flex-direction: column; gap: 6px; }
  .names { display: flex; flex-wrap: wrap; gap: 6px; }
  .chip {
    display: inline-flex; align-items: center; gap: 5px;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 999px;
    color: var(--text); font-size: 0.75rem; padding: 3px 10px;
      max-width: 100%; min-width: 0;
  }
  .chip .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); }
  .chip em { color: var(--dim); font-family: var(--font-mono); font-size: 0.62rem; font-style: normal; }
  button.danger {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    color: var(--acc-magenta); font-family: var(--font-mono); font-size: 0.85rem;
    padding: 10px; cursor: pointer;
  }
  .about { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; text-align: center; margin-top: 20px; }
</style>
