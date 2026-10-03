<!--
  SPOILER ZONE — the home-screen companion. Entirely derived from real
  progress (no nag states, only celebration): appears at 10 lifetime
  completions as an egg, wiggles as hatching nears, then evolves at
  milestones. Tap for a reaction (cooldown so it stays charming); once the
  den is open, press and hold to go inside.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { lifetimeCompletions } from '../domain/stats';
  import { PET_LINES } from './content/extras';
  import { companionForm, denOpen, wornTrinket } from './den';
  import { navigate } from '../ui/router.svelte';
  import { presenter } from './presenter.svelte';
  import { burstFromElement, motionOk } from '../ui/fx/particles';
  import { haptic } from '../ui/fx/haptics';

  const lifetime = $derived(lifetimeCompletions(app.state.tasks));
  const stage = $derived(companionForm(lifetime));
  const canEnter = $derived(denOpen(lifetime, app.eggMarks));
  const worn = $derived(wornTrinket({ unlocks: app.eggUnlocks, marks: app.eggMarks }));

  const nearHatch = $derived(stage?.[1] === '🥚' && lifetime >= 20);
  const onFire = $derived(app.eggStreak >= 3);

  let lastPoke = 0;
  let el = $state<HTMLButtonElement | null>(null);
  let bouncing = $state(false);

  /** How long a press must last to count as a hold rather than a tap. */
  const HOLD_MS = 550;
  let holdTimer: ReturnType<typeof setTimeout> | undefined;
  /** Set when a hold has just carried the reader inside, so the release that follows is not also a poke. */
  let held = false;

  function pressStart() {
    if (!canEnter) return;
    clearTimeout(holdTimer);
    holdTimer = setTimeout(() => {
      held = true;
      haptic('heavy');
      navigate({ name: 'den' });
    }, HOLD_MS);
  }

  function pressEnd() {
    clearTimeout(holdTimer);
  }

  function poke() {
    if (held) { held = false; return; }
    if (!stage) return;
    if (el) burstFromElement(el, { count: 8, power: 0.7 });
    haptic('tick');
    bouncing = true;
    setTimeout(() => (bouncing = false), 450);
    const now = Date.now();
    if (now - lastPoke < 60_000) return; // reactions stay special
    lastPoke = now;
    if (stage[1] === '🥚') {
      presenter.show({ kind: 'note', emoji: '🥚', accent: 'cyan', text: nearHatch ? '*the egg wobbles urgently*' : '*the egg wobbles*' });
    } else {
      const line = PET_LINES[Math.floor(Math.random() * PET_LINES.length)]!;
      presenter.show({ kind: 'note', emoji: stage[1], accent: 'cyan', text: line });
    }
    // Hatching is a discovery.
    if (stage[1] !== '🥚') app.grantUnlockAndShow('hatchling');
  }
</script>

{#if stage}
  <button bind:this={el} class="pet" class:wiggle={nearHatch && motionOk()} class:bounce={bouncing}
    data-testid="companion" title={stage[2]} aria-label={stage[2]} onclick={poke}
    onpointerdown={pressStart} onpointerup={pressEnd} onpointerleave={pressEnd} onpointercancel={pressEnd}
    oncontextmenu={(e) => { if (canEnter) e.preventDefault(); }}>
    <span class="body">{stage[1]}</span>
    {#if worn}<span class="trinket" data-testid="companion-trinket">{worn.emoji}</span>{/if}
    {#if onFire}<span class="mood">🔥</span>{/if}
  </button>
{/if}

<style>
  .pet {
    position: fixed;
    right: calc(14px + env(safe-area-inset-right));
    bottom: calc(14px + env(safe-area-inset-bottom));
    background: none; border: none; cursor: pointer;
    font-size: 1.7rem; z-index: 50; padding: 6px;
    filter: drop-shadow(0 2px 8px rgba(0, 0, 0, 0.5));
    /* A press-and-hold opens the den; without these, iOS answers the same
       hold with a text-selection callout over the companion. */
    -webkit-touch-callout: none; -webkit-user-select: none; user-select: none;
  }
  .trinket { position: absolute; top: -4px; left: -2px; font-size: 0.85rem; transform: rotate(-14deg); pointer-events: none; }
  .body { display: inline-block; }
  .mood { position: absolute; top: -2px; right: -2px; font-size: 0.8rem; }
  .wiggle .body { animation: wiggle 2.4s ease-in-out infinite; }
  @keyframes wiggle {
    0%, 78%, 100% { transform: rotate(0); }
    82% { transform: rotate(-12deg); }
    86% { transform: rotate(10deg); }
    90% { transform: rotate(-8deg); }
    94% { transform: rotate(5deg); }
  }
  .bounce .body { animation: bounce 0.45s cubic-bezier(0.3, 1.6, 0.5, 1); }
  @keyframes bounce { 40% { transform: translateY(-10px) scale(1.15); } }
  @media (prefers-reduced-motion: reduce) {
    .wiggle .body, .bounce .body { animation: none; }
  }
</style>
