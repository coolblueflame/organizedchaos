<!--
  SPOILER ZONE: Kevin's vault (#/vault), the room behind the little door in
  ENTROPY's notebook (see ./vault). Kevin, who is very still, and his shelf
  of lost things, one more for each week the room is visited. Until the door
  has been opened the room says so and shows nothing. Nothing here happens
  unless the reader taps it.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from '../ui/router.svelte';
  import { appDayKey } from '../domain/time';
  import { clock } from '../ui/clock.svelte';
  import { haptic } from '../ui/fx/haptics';
  import {
    KEVIN_AFTER, KEVIN_FINDS, KEVIN_MOVES, KEVIN_PATIENCE, KEVIN_STILL, VAULT_MARKS, vaultFinds, vaultOpened,
  } from './vault';

  const opened = $derived(vaultOpened(app.eggMarks));
  const finds = $derived(vaultFinds(app.eggMarks));
  const movedBefore = $derived(app.eggMarks[VAULT_MARKS.kevinMoved] !== undefined);

  /** What the room says under Kevin; a new find announces itself here on arrival. */
  let caption = $state('');

  // Each visit in a new week turns up one more lost thing. Recorded once the
  // delight state has loaded, since a mark made before then would vanish.
  let visited = false;
  $effect(() => {
    if (visited || !opened || !app.eggsLoaded) return;
    visited = true;
    const found = app.visitVault(appDayKey(clock.now, app.state.settings.rolloverHour));
    if (found) caption = `Kevin found something new: ${found.label}. it is on the shelf.`;
  });

  /** Taps on Kevin this visit. Kept per visit, so the patience has to happen in one sitting. */
  let taps = $state(0);
  let hopping = $state(false);

  function tapKevin() {
    taps += 1;
    if (taps === KEVIN_PATIENCE) {
      haptic('success');
      hopping = true;
      setTimeout(() => (hopping = false), 600);
      caption = KEVIN_MOVES;
      app.noteKevinMoved();
      return;
    }
    haptic('tick');
    // Once he has been seen to move, the room stops pretending it never happened.
    const lines = movedBefore || taps > KEVIN_PATIENCE ? KEVIN_AFTER : KEVIN_STILL;
    caption = lines[(taps - 1) % lines.length]!;
  }
</script>

<main data-testid="vault">
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'den' })}>‹</button>
    <h1>The Vault</h1>
  </header>

  {#if !opened}
    <p class="dim" data-testid="vault-locked">// a little door, shut. it is only a drawing from this side.</p>
  {:else}
    <section class="room">
      <p class="dim">// behind the little door: a room the size of a shoebox, and very tidy. Kevin lives here.</p>
      <button class="kevin" class:hop={hopping} data-testid="vault-kevin" aria-label="Kevin" onclick={tapKevin}>🐇</button>
      <p class="name">Kevin</p>
      <p class="caption" data-testid="vault-caption">{caption || 'Kevin is very still.'}</p>
    </section>

    <section class="collection">
      <h2>Kevin’s collection <span class="count" data-testid="vault-count">{finds.length} of {KEVIN_FINDS.length}</span></h2>
      <ul class="finds">
        {#each finds as f (f.label)}
          <li data-testid="vault-find"><span class="emoji" aria-hidden="true">{f.emoji}</span> {f.label}</li>
        {/each}
      </ul>
      {#if finds.length < KEVIN_FINDS.length}
        <p class="dim">// Kevin finds one more lost thing each week someone visits. he does not say where.</p>
      {:else}
        <p class="dim" data-testid="vault-complete">// the collection is complete. Kevin made something from the leftover lint. it is on the den shelf.</p>
      {/if}
    </section>
  {/if}
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); display: flex; flex-direction: column; gap: 14px; }
  header { display: flex; align-items: center; gap: 8px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  h2 {
    margin: 0 0 8px; font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--acc-purple); display: flex; justify-content: space-between;
  }
  .count { color: var(--dim); }
  .dim { margin: 0; color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }

  /* A small, dim room lit from one side, like the inside of a drawer. */
  .room {
    display: flex; flex-direction: column; align-items: center; gap: 6px;
    padding: 18px 12px 16px; border-radius: 14px; border: 1px solid var(--line);
    background:
      radial-gradient(50% 40% at 20% 30%, rgb(255 214 102 / 0.12), transparent 70%),
      linear-gradient(var(--bg1), var(--bg2));
  }
  .room > .dim { text-align: center; }
  .kevin { background: none; border: none; cursor: pointer; font-size: 3.4rem; line-height: 1.1; padding: 6px 12px; }
  .hop { animation: hop 0.6s cubic-bezier(0.3, 1.6, 0.5, 1); }
  @keyframes hop { 40% { transform: translateY(-14px); } }
  .name { margin: 0; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text); }
  .caption {
    margin: 0; min-height: 2.8em; max-width: 30em; text-align: center;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; line-height: 1.5;
  }

  .finds { list-style: none; margin: 0 0 8px; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .finds li {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px; padding: 8px 12px;
    font-size: 0.86rem; display: flex; align-items: center; gap: 10px;
  }
  .emoji { font-size: 1.2rem; }
  @media (prefers-reduced-motion: reduce) { .hop { animation: none; } }
</style>
