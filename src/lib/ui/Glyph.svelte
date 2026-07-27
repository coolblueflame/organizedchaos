<!--
  Line-drawn status glyphs for dense UI.

  Emoji were the obvious first choice and the wrong one: they render as a
  different picture on every OS, and a colour cartoon fights the monochrome
  IDE look of a task row. These are stroked in `currentColor`, so they inherit
  whatever the surrounding text is doing — dim by default, accent when the row
  highlights — and they look identical everywhere.

  Emoji are still fine in prose (toasts, notes, headings) where they read as
  punctuation rather than as UI furniture.
-->
<script lang="ts">
  /** notes = a page with lines; blocked = no-entry; timebox = hourglass; period = clock. */
  type GlyphName = 'notes' | 'blocked' | 'timebox' | 'period';

  let { name, size = 11, title }: {
    name: GlyphName;
    /** Height in px; the width follows each glyph's own aspect. */
    size?: number;
    title?: string;
  } = $props();

  // viewBox is 12x12 for the round glyphs, 10x12 for the page, so they optically
  // match at the same height rather than matching only on paper.
  const box = $derived(name === 'notes' ? '0 0 10 12' : '0 0 12 12');
  const width = $derived(name === 'notes' ? (size * 10) / 12 : size);
</script>

<svg
  class="glyph"
  viewBox={box}
  width={width}
  height={size}
  role={title ? 'img' : 'presentation'}
  aria-label={title}
  aria-hidden={title ? undefined : 'true'}
>
  {#if title}<title>{title}</title>{/if}

  {#if name === 'notes'}
    <rect x="0.5" y="0.5" width="9" height="11" rx="1.5" />
    <line x1="3" y1="4.5" x2="7" y2="4.5" />
    <line x1="3" y1="7.5" x2="6" y2="7.5" />
  {:else if name === 'blocked'}
    <!-- No-entry: a ring with a single bar across it. -->
    <circle cx="6" cy="6" r="5.2" />
    <line x1="3.1" y1="6" x2="8.9" y2="6" />
  {:else if name === 'timebox'}
    <!-- Hourglass: capped top and bottom, pinched in the middle. -->
    <line x1="3" y1="1" x2="9" y2="1" />
    <line x1="3" y1="11" x2="9" y2="11" />
    <path d="M3.4 1 L8.6 1 L4.6 6 L8.6 11 L3.4 11 L7.4 6 Z" />
  {:else}
    <!-- Clock: a ring with hands at roughly ten-past. -->
    <circle cx="6" cy="6" r="5.2" />
    <path d="M6 3.1 L6 6 L8.3 7.3" />
  {/if}
</svg>

<style>
  .glyph {
    display: block; flex: none;
    fill: none; stroke: currentColor;
    stroke-width: 1; stroke-linecap: round; stroke-linejoin: round;
  }
</style>
