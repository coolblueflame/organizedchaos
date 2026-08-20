<!--
  The compact face of a note's links: one "↗ hostname" chip per unique URL.
  Exists for the two surfaces that never show notes PROSE — the editor (its
  notes live in a textarea, which cannot carry an anchor) and the current-task
  card (which shows only the checklist face of notes) — so a link buried in
  either is still one tap away (2026-08-20 ask).
-->
<script lang="ts">
  import { extractUrls, linkLabel } from '../domain/links';

  let { notes, testid }: { notes: string; testid: string } = $props();
  const urls = $derived(extractUrls(notes));
</script>

{#if urls.length > 0}
  <div class="link-chips" data-testid={testid}>
    {#each urls as url (url)}
      <a class="link-chip" href={url} target="_blank" rel="noopener noreferrer"
        title={url} onclick={(e) => e.stopPropagation()}>
        ↗ {linkLabel(url)}
      </a>
    {/each}
  </div>
{/if}

<style>
  .link-chips { display: flex; flex-wrap: wrap; gap: 6px; }
  .link-chip {
    display: inline-flex; align-items: center; gap: 4px;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 999px;
    color: var(--acc-blue); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 3px 10px; text-decoration: none;
    max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  @media (hover: hover) { .link-chip:hover { border-color: var(--acc-blue); } }
</style>
