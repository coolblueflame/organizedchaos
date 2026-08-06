<!--
  The streak flame, animated (2026-07-29 ask): the tongues flicker frame by
  frame, and the fire grows for a moment whenever a task is completed.

  Frame swapping is done in JS on <path d>, NOT with CSS `d: path()` — iOS
  WebKit doesn't animate that property, and the iPhone is the primary target.
  Three hand-drawn variants share the flame's silhouette (it must keep leaning
  and licking to one side — see Glyph.svelte's note about raindrops); only the
  tip sway and the inner tongue move, so the flicker reads as fire rather than
  as a shape morph. The cycle order avoids A-B-A-B metronome ticking.

  Deliberately still: under reduced motion, and under automation — a child that
  repaints every 150ms would trip Playwright's element-stability checks on the
  streak tile (same convention as the delight layer).
-->
<script lang="ts">
  import { motionOk } from './fx/particles';

  let { size = 15, flareKey = 0, title }: {
    /** Height/width in px (the flame is drawn square). */
    size?: number;
    /** Bump this (e.g. with today's completion count) to make the fire flare. */
    flareKey?: number;
    title?: string;
  } = $props();

  const FRAMES = [
    // F0 — the original resting flame (identical to Glyph's 'flame').
    `M6.6 0.6 C6.9 2.6 8.4 3.4 8.9 5.6 C9.4 8.4 7.9 11 5.7 11
     C3.6 11 2.5 9.4 2.9 7.4 C3.2 6 4.2 5.4 4.9 4.2
     C5 5.4 5.3 5.9 5.9 6.3 C5.1 4.3 5.5 2.2 6.6 0.6 Z`,
    // F1 — tip sways left, the inner lick bites deeper.
    `M6.2 0.5 C6.4 2.5 8.5 3.6 9.0 5.8 C9.5 8.5 7.9 11 5.7 11
     C3.6 11 2.4 9.3 2.8 7.3 C3.1 5.9 4.3 5.2 4.8 3.9
     C5.0 5.2 5.4 5.8 6.1 6.2 C5.2 4.1 5.2 2.1 6.2 0.5 Z`,
    // F2 — tip sways right, the inner tongue rides higher.
    `M7.0 0.8 C7.2 2.8 8.3 3.3 8.8 5.5 C9.3 8.3 7.9 11 5.7 11
     C3.6 11 2.6 9.5 3.0 7.5 C3.3 6.1 4.1 5.6 5.0 4.4
     C5.1 5.5 5.2 5.9 5.8 6.4 C4.9 4.4 5.8 2.4 7.0 0.8 Z`,
  ];
  const ORDER = [0, 1, 0, 2, 1, 2];

  const still = (): boolean =>
    !motionOk() || (typeof navigator !== 'undefined' && navigator.webdriver);

  let frame = $state(0);
  let flaring = $state(false);

  $effect(() => {
    if (still()) return;
    let i = 0;
    const id = setInterval(() => {
      i = (i + 1) % ORDER.length;
      frame = ORDER[i]!;
    }, 150);
    return () => clearInterval(id);
  });

  // Flare on change, not on mount — opening the app is not an achievement.
  let seededFlare = false;
  $effect(() => {
    void flareKey;
    if (!seededFlare) { seededFlare = true; return; }
    if (still()) return;
    flaring = true;
    const id = setTimeout(() => (flaring = false), 850);
    return () => clearTimeout(id);
  });
</script>

<!-- The glow is a REAL circle painted behind the flame, faded with opacity —
     never a filter. The old `drop-shadow` transition sat on the same layer
     the flicker repaints every 150ms, and iOS WebKit composites that badly:
     the layer's rectangular backing store showed through as a SQUARE glow
     with stale black patches where the re-rasterized flame should be (Ben's
     2026-08-06 report: "more like a square than a circle", "solid black,
     while the edges remain"). Opacity on a separate element gives the
     compositor nothing to corrupt. -->
<span class="holder" class:flaring data-testid="flame-holder">
  <svg
    class="flame"
    class:flaring
    viewBox="0 0 12 12"
    width={size}
    height={size}
    role={title ? 'img' : 'presentation'}
    aria-label={title}
    aria-hidden={title ? undefined : 'true'}
  >
    <path d={FRAMES[frame]} />
  </svg>
</span>

<style>
  .holder {
    position: relative;
    display: inline-block;
    /* The baseline tweak the svg used to carry — the wrapper owns it now,
       with the svg a plain block inside, so text lines sit exactly as
       they did before the wrapper existed. */
    vertical-align: -0.08em;
    /* Fence the glow's z-index:-1 inside — without a stacking context it
       could sink beneath an ancestor's content. */
    isolation: isolate;
  }
  .holder::after {
    content: '';
    position: absolute;
    inset: -45%;
    z-index: -1;
    border-radius: 50%;
    background: radial-gradient(circle, currentColor 0%, transparent 65%);
    opacity: 0;
    transition: opacity 240ms ease;
    pointer-events: none;
  }
  .holder.flaring::after { opacity: 0.55; }
  .flame {
    display: block;
    overflow: visible;
    transform-origin: 50% 92%;
    transition: transform 240ms cubic-bezier(0.2, 1.6, 0.4, 1);
  }
  .flame path { fill: currentColor; stroke: none; }
  .flame.flaring { transform: scale(1.4); }
  @media (prefers-reduced-motion: reduce) {
    .flame { transition: none; }
    .flame.flaring { transform: none; }
    .holder::after { transition: none; }
    .holder.flaring::after { opacity: 0; }
  }
</style>
