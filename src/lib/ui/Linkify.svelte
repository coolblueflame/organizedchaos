<!--
  Notes text with its URLs tappable (2026-08-20 ask). Renders SEGMENTS, never
  markup: the text is user-synced data, and building anchors from parsed
  pieces (http(s)-only, see domain/links) is what keeps a note from ever
  becoming an injection surface. stopPropagation because every card that
  shows notes also has a tap-to-toggle/collapse ancestor — following a link
  must not also fold the card the link lives on.
-->
<script lang="ts">
  import { linkifySegments } from '../domain/links';

  let { text }: { text: string } = $props();
  const segments = $derived(linkifySegments(text));
</script>

{#each segments as seg, i (i)}{#if seg.kind === 'link'}<a class="note-link" href={seg.href}
  target="_blank" rel="noopener noreferrer"
  onclick={(e) => e.stopPropagation()}>{seg.text}</a>{:else}{seg.text}{/if}{/each}

<style>
  .note-link {
    color: var(--acc-blue); text-decoration: underline; text-underline-offset: 2px;
    /* Long URLs must wrap inside their card, not push through its border. */
    overflow-wrap: anywhere;
  }
  @media (hover: hover) { .note-link:hover { color: var(--acc-cyan); } }
</style>
