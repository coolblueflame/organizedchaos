<!--
  Line-drawn glyphs for buttons and UI chrome.

  Emoji were the obvious first choice and the wrong one: they render as a
  different picture on every OS, and colour cartoons fight the monochrome IDE
  look. These are stroked in `currentColor`, so they inherit whatever the
  surrounding text is doing — dim by default, accent when something is active —
  and they look identical everywhere.

  Scope, per Ben (2026-07-28): buttons and general UI use these; emoji stay
  welcome in *content* — delight notes, facts, the companion, OS notifications
  — where they read as expression rather than as interface furniture.

  Plain typographic marks (✕ ✓ → ⋯ ↻ ↳ ⧗ ⌕ ⓘ) are deliberately NOT here: they
  render as text on every platform already, and they suit the monospace look.
-->
<script lang="ts">
  type GlyphName =
    | 'notes' | 'blocked' | 'timebox' | 'period' | 'pause' | 'play'
    | 'dice' | 'moon' | 'bolt' | 'install' | 'upload' | 'award' | 'locked'
    | 'flame' | 'settings' | 'escalate' | 'grip'
    | 'box' | 'box-checked' | 'box-all';

  let { name, size = 11, title }: {
    name: GlyphName;
    /** Height in px; the width follows each glyph's own aspect. */
    size?: number;
    title?: string;
  } = $props();

  // The page glyph is narrower than it is tall; everything else is square, so
  // they optically match at a shared height rather than only on paper.
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
  {:else if name === 'period'}
    <!-- Clock: a ring with hands at roughly ten-past. -->
    <circle cx="6" cy="6" r="5.2" />
    <path d="M6 3.1 L6 6 L8.3 7.3" />
  {:else if name === 'pause'}
    <!-- Transport controls are solid: you press these, you don't read them. -->
    <rect class="solid" x="3" y="1.8" width="2.4" height="8.4" rx="0.7" />
    <rect class="solid" x="6.6" y="1.8" width="2.4" height="8.4" rx="0.7" />
  {:else if name === 'play'}
    <path class="solid" d="M3.6 1.8 L10 6 L3.6 10.2 Z" />
  {:else if name === 'dice'}
    <!-- The randomizer's own mark: a die showing three pips. -->
    <rect x="1" y="1" width="10" height="10" rx="2.4" />
    <circle class="solid pip" cx="3.7" cy="3.7" r="0.85" />
    <circle class="solid pip" cx="6" cy="6" r="0.85" />
    <circle class="solid pip" cx="8.3" cy="8.3" r="0.85" />
  {:else if name === 'moon'}
    <!--
      Crescent: outer arc the long way round, then a wider arc back to carve
      the bite. Both horns sit on a circle centred at x=6.09 with r=4.9, so the
      leftmost ink lands at 1.19 and the stroke still clears the box — the
      previous version's arc centred at 4.52 with r=5.1, putting its left edge
      at -0.58, and it was visibly clipped (spotted by Ben, 2026-07-28).
    -->
    <path d="M8.55 1.76 A4.9 4.9 0 1 0 8.55 10.24 A5.6 5.6 0 0 1 8.55 1.76 Z" />
  {:else if name === 'bolt'}
    <path class="solid" d="M7.2 0.8 L3 6.6 L5.6 6.6 L4.8 11.2 L9 5.2 L6.4 5.2 Z" />
  {:else if name === 'install'}
    <!-- Arrow landing on a baseline: the universal "put it on your device". -->
    <path d="M6 1.2 L6 7.6" />
    <path d="M3.4 5.2 L6 7.9 L8.6 5.2" />
    <path d="M2.2 10.6 L9.8 10.6" />
  {:else if name === 'upload'}
    <!-- Mirror of install: up and off the baseline. -->
    <path d="M6 10.8 L6 4.4" />
    <path d="M3.4 6.8 L6 4.1 L8.6 6.8" />
    <path d="M2.2 1.4 L9.8 1.4" />
  {:else if name === 'award'}
    <!-- Medal: a disc on two ribbon legs. -->
    <circle cx="6" cy="4.3" r="3.3" />
    <path d="M4.1 7 L3 11.2 L6 9.6 L9 11.2 L7.9 7" />
  {:else if name === 'locked'}
    <rect x="2.4" y="5.4" width="7.2" height="5.8" rx="1.2" />
    <path d="M4.2 5.4 V3.9 a1.8 1.8 0 0 1 3.6 0 V5.4" />
  {:else if name === 'flame'}
    <!-- Leans and licks to one side; a symmetrical one just reads as a
         raindrop, which is the opposite of "on fire". -->
    <path class="solid" d="M6.6 0.6 C6.9 2.6 8.4 3.4 8.9 5.6
      C9.4 8.4 7.9 11 5.7 11 C3.6 11 2.5 9.4 2.9 7.4
      C3.2 6 4.2 5.4 4.9 4.2 C5 5.4 5.3 5.9 5.9 6.3
      C5.1 4.3 5.5 2.2 6.6 0.6 Z" />
  {:else if name === 'settings'}
    <!-- Sliders, not a cog: eight teeth at 11px turn into a sun, and this
         reads as "settings" instantly at any size. -->
    <path d="M1.6 4 H10.4 M1.6 8.4 H10.4" />
    <circle class="knob" cx="4.2" cy="4" r="1.5" />
    <circle class="knob" cx="7.8" cy="8.4" r="1.5" />
  {:else if name === 'escalate'}
    <!-- Deadline pressure: a stack of chevrons pointing up. -->
    <path d="M2.6 6.6 L6 3.2 L9.4 6.6" />
    <path d="M2.6 10 L6 6.6 L9.4 10" />
  {:else if name === 'grip'}
    <!-- The universal "pick me up here": two columns of dots. -->
    {#each [2.6, 6, 9.4] as cy (cy)}
      <circle class="solid" cx="4.4" cy={cy} r="0.95" />
      <circle class="solid" cx="7.6" cy={cy} r="0.95" />
    {/each}
  {:else if name === 'box'}
    <rect x="1.2" y="1.2" width="9.6" height="9.6" rx="2" />
  {:else if name === 'box-checked'}
    <rect x="1.2" y="1.2" width="9.6" height="9.6" rx="2" />
    <path d="M3.6 6.2 L5.3 8 L8.5 4.2" />
  {:else}
    <!-- box-all: "everything in this group", a box with a filled core. -->
    <rect x="1.2" y="1.2" width="9.6" height="9.6" rx="2" />
    <rect class="solid" x="3.9" y="3.9" width="4.2" height="4.2" rx="1" />
  {/if}
</svg>

<style>
  .glyph {
    display: block; flex: none;
    fill: none; stroke: currentColor;
    stroke-width: 1; stroke-linecap: round; stroke-linejoin: round;
  }
  .solid { fill: currentColor; stroke: none; }
  /* Pips need no outline of their own, or they blur together at 11px. */
  .pip { stroke: none; }
  /* Knobs sit on the rail, so they need the surface colour behind them. */
  .knob { fill: var(--bg0); }
</style>
