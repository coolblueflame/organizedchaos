<!--
  SPOILER ZONE — one of ENTROPY's sparkles (see ./sparkles). Each screen that
  can hide one mounts this with its own spot name; it draws only on the
  screen and app-day it belongs to, and only until it is found. Never
  announced, never in the way: a small glyph at the edge of a heading,
  waiting to be noticed.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { clock } from '../ui/clock.svelte';
  import { appDayKey } from '../domain/time';
  import { SPARKLE_STORY_BEAT, sparkleFound, sparkleSpot, type SparkleSpot } from './sparkles';
  import { burstFromElement } from '../ui/fx/particles';
  import { haptic } from '../ui/fx/haptics';

  /** Which screen this is. */
  let { spot }: { spot: SparkleSpot } = $props();

  const day = $derived(appDayKey(clock.now, app.state.settings.rolloverHour));

  /**
   * Under automation the hunt is silent unless a test names the spot in
   * OC_SPARKLE, so a sparkle never shifts a layout another test measures.
   */
  const hidesHere = $derived.by(() => {
    if (typeof navigator !== 'undefined' && navigator.webdriver) {
      return typeof localStorage !== 'undefined' && localStorage.getItem('OC_SPARKLE') === spot;
    }
    return app.eggStoryStage > SPARKLE_STORY_BEAT && sparkleSpot(day) === spot;
  });
  const shown = $derived(app.eggsLoaded && hidesHere && !sparkleFound(app.eggMarks, day));

  let el = $state<HTMLButtonElement | null>(null);

  function collect() {
    if (el) burstFromElement(el, { count: 18, power: 0.8 });
    haptic('success');
    app.collectSparkle(day);
  }
</script>

{#if shown}
  <button bind:this={el} class="sparkle" data-testid="sparkle" aria-label="a sparkle" onclick={collect}>
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <path d="M8 0.5 L9.6 6.4 L15.5 8 L9.6 9.6 L8 15.5 L6.4 9.6 L0.5 8 L6.4 6.4 Z" />
    </svg>
  </button>
{/if}

<style>
  /* Small enough to miss, big enough to tap: the glyph is 14px, the target
     around it is not. */
  .sparkle {
    display: inline-grid; place-items: center; flex: none;
    width: 30px; height: 30px; margin: -8px 0; padding: 0;
    background: none; border: none; cursor: pointer; vertical-align: middle;
    color: var(--acc-yellow);
  }
  svg { fill: currentColor; animation: twinkle 2.6s ease-in-out infinite; }
  @keyframes twinkle {
    0%, 100% { opacity: 0.55; transform: scale(0.8) rotate(0deg); }
    50% { opacity: 1; transform: scale(1.1) rotate(45deg); }
  }
  @media (prefers-reduced-motion: reduce) {
    svg { animation: none; opacity: 0.9; }
  }
</style>
