<!--
  SPOILER ZONE — the home-screen companion. Entirely derived from real
  progress (no nag states, only celebration): appears at 10 lifetime
  completions as an egg, wiggles as hatching nears, then evolves at
  milestones. Tap for a reaction (cooldown so it stays charming).
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { completionCounts } from '../domain/stats';
  import { PET_LINES, PET_STAGES } from './content/extras';
  import { presenter } from './presenter.svelte';
  import { burstFromElement, motionOk } from '../ui/fx/particles';
  import { haptic } from '../ui/fx/haptics';

  const lifetime = $derived(
    completionCounts(app.state.tasks, new Date(), app.state.settings.rolloverHour).lifetime);

  const stage = $derived.by(() => {
    let current: [number, string, string] | null = null;
    for (const s of PET_STAGES) if (lifetime >= s[0]) current = s;
    return current;
  });

  const nearHatch = $derived(stage?.[1] === '🥚' && lifetime >= 20);
  const onFire = $derived(app.eggStreak >= 3);

  let lastPoke = 0;
  let el = $state<HTMLButtonElement | null>(null);
  let bouncing = $state(false);

  function poke() {
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
    data-testid="companion" title={stage[2]} aria-label={stage[2]} onclick={poke}>
    <span class="body">{stage[1]}</span>
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
  }
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
