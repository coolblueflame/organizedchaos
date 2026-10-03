<!--
  SPOILER ZONE — the den (#/den): the companion's room. The companion at
  full size, a shelf of trinkets it can wear, ENTROPY's dice table, and a
  scrapbook of the big moments this library has seen. Opened by the
  mailbox invitation once the library reaches the dragon rung; reached
  again by holding the companion on Home, or from Stats. Nothing in here
  happens unless the reader taps it.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from '../ui/router.svelte';
  import { lifetimeCompletions } from '../domain/stats';
  import { appDayKey } from '../domain/time';
  import { MOMENTS } from './registry';
  import {
    DEN_MARKS, SCRAPBOOK, TRINKETS, WEAR_PREFIX, companionForm, denOpen, wornTrinket, type Trinket,
  } from './den';
  import { DEN_LINES, DEN_WAY_BACK, DEN_WELCOME } from './content/den';
  import { presenter } from './presenter.svelte';
  import DiceDuel from './DiceDuel.svelte';
  import { haptic } from '../ui/fx/haptics';
  import { SPARKLE_STORY_BEAT, sparkleTally } from './sparkles';
  import { seasonNow } from './seasonNow.svelte';
  import { SEASON_LOOKS } from './content/seasons';

  const lifetime = $derived(lifetimeCompletions(app.state.tasks));
  const open = $derived(denOpen(lifetime, app.eggMarks));
  const form = $derived(companionForm(lifetime));
  const progress = $derived({ unlocks: app.eggUnlocks, marks: app.eggMarks });
  const worn = $derived(wornTrinket(progress));
  /** What it has on: the reader's choice first, else the season's costume. */
  const dressed = $derived(worn?.emoji ?? (seasonNow.current ? SEASON_LOOKS[seasonNow.current].costume : null));
  const welcomed = $derived(app.eggMarks[DEN_MARKS.welcomed] !== undefined);
  const seen = $derived(MOMENTS.filter((m) => app.eggMarks[`moment:${m}`] !== undefined));
  const sparkles = $derived(sparkleTally(app.eggMarks));

  const mood = $derived.by(() => {
    const streak = app.eggStreak;
    if (streak >= 7) return `radiant. the flame is ${streak} days old.`;
    if (streak >= 3) return 'toasty. the flame is going nicely.';
    if (app.eggLastCompletionDay === appDayKey(new Date(), app.state.settings.rolloverHour)) {
      return 'content. the list got fed today.';
    }
    return 'cozy. waiting patiently, as companions do.';
  });

  // Walking in counts as opening the invitation, so it stops waiting in the
  // mailbox however the reader found the door.
  $effect(() => {
    if (open && app.eggMarks[DEN_MARKS.invited] === undefined) app.markEgg(DEN_MARKS.invited);
  });

  let bubble = $state('');
  let hopping = $state(false);
  let lastPoke = 0;

  function poke() {
    const now = Date.now();
    if (now - lastPoke < 900) return;
    lastPoke = now;
    haptic('tick');
    hopping = true;
    setTimeout(() => (hopping = false), 500);
    let next = bubble;
    while (next === bubble) next = DEN_LINES[Math.floor(Math.random() * DEN_LINES.length)]!;
    bubble = next;
  }

  /** What the line under the shelf says about the trinket tapped last. */
  let caption = $state('tap something to try it on.');

  /** Put a trinket on, or take off the one being worn. */
  function wear(t: Trinket) {
    haptic('tick');
    const off = worn?.id === t.id;
    app.markEgg(`${WEAR_PREFIX}${off ? 'none' : t.id}`, Date.now());
    caption = off ? `took off ${t.label}.` : `wearing ${t.label}.`;
  }
</script>

<main data-testid="den">
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>The Den</h1>
  </header>

  {#if !open || !form}
    <p class="locked" data-testid="den-locked">// the door is shut. something behind it is still growing.</p>
  {:else}
    {#if !welcomed}
      <section class="welcome" data-testid="den-welcome">
        <p class="from">▚ ENTROPY</p>
        <p>{DEN_WELCOME}</p>
        <p class="dim">{DEN_WAY_BACK}</p>
        <button data-testid="den-welcome-ok" onclick={() => app.markEgg(DEN_MARKS.welcomed)}>come in</button>
      </section>
    {/if}

    <section class="room">
      {#if bubble}<p class="bubble" data-testid="den-bubble">{bubble}</p>{/if}
      <button class="pet" class:hop={hopping} data-testid="den-companion" aria-label="poke {form[2]}" onclick={poke}>
        <span class="body">{form[1]}</span>
        {#if dressed}<span class="worn" data-testid="den-worn">{dressed}</span>{/if}
      </button>
      <p class="name">{form[2]}</p>
      <p class="mood" data-testid="den-mood">mood: {mood}</p>
      {#if sparkles > 0 || app.eggStoryStage > SPARKLE_STORY_BEAT}
        <p class="mood" data-testid="den-sparkles">sparkles found: {sparkles}</p>
      {/if}
    </section>

    <DiceDuel />

    <section class="shelf">
      <h2>the shelf <span class="count">{TRINKETS.filter((t) => t.earned(progress)).length} of {TRINKETS.length}</span></h2>
      <div class="trinkets">
        {#each TRINKETS as t (t.id)}
          {#if t.earned(progress)}
            <button class="trinket" class:on={worn?.id === t.id} data-testid="trinket-{t.id}"
              aria-pressed={worn?.id === t.id} aria-label={t.label} onclick={() => wear(t)}>{t.emoji}</button>
          {:else}
            <button class="trinket locked" data-testid="trinket-{t.id}" aria-label="locked: {t.hint}"
              onclick={() => (caption = `locked: ${t.hint}.`)}>?</button>
          {/if}
        {/each}
      </div>
      <p class="caption" data-testid="shelf-caption">{caption}</p>
    </section>

    <section class="scrapbook">
      <h2>the scrapbook <span class="count" data-testid="scrapbook-count">{seen.length} of {MOMENTS.length}</span></h2>
      <p class="dim">// ENTROPY only started keeping this recently, so most pages are blank. it says that’s the exciting part.</p>
      <div class="pages">
        {#each MOMENTS as m (m)}
          {#if app.eggMarks[`moment:${m}`] !== undefined}
            <button class="page seen" data-testid="scrapbook-{m}" onclick={() => presenter.show({ kind: 'moment', moment: m })}>
              <span class="title">{SCRAPBOOK[m].name}</span><span class="again">▶ again</span>
            </button>
          {:else}
            <div class="page" data-testid="scrapbook-{m}">
              <span class="title">???</span><span class="again">{SCRAPBOOK[m].hint}</span>
            </div>
          {/if}
        {/each}
      </div>
    </section>

    <nav class="links">
      {#if app.eggStoryStage > 0}
        <button data-testid="den-story-link" onclick={() => navigate({ name: 'story' })}><span aria-hidden="true">▚</span> the story so far</button>
      {/if}
      <button data-testid="den-discoveries-link" onclick={() => navigate({ name: 'stats' })}>discoveries</button>
    </nav>
    <p class="dim foot">{DEN_WAY_BACK}</p>
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
  .dim, .locked { margin: 0; color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }
  .foot { text-align: center; }

  .welcome {
    border: 1px solid var(--acc-green); border-radius: 12px; padding: 14px;
    display: flex; flex-direction: column; gap: 8px; font-size: 0.9rem; line-height: 1.5;
  }
  .welcome p { margin: 0; }
  .welcome .from { font-family: var(--font-mono); font-size: 0.72rem; color: var(--acc-green); }
  .welcome button {
    align-self: flex-start; background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 8px;
    color: var(--acc-green); font-family: var(--font-mono); padding: 6px 14px; cursor: pointer;
  }

  /* The room: a warm floor, the companion standing on it. */
  .room {
    position: relative; display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 26px 12px 14px; border-radius: 14px;
    background:
      radial-gradient(60% 30% at 50% 88%, rgb(210 168 255 / 0.18), transparent 70%),
      linear-gradient(var(--bg1), var(--bg2));
    border: 1px solid var(--line);
  }
  .bubble {
    margin: 0 0 6px; max-width: 30em; text-align: center;
    background: var(--bg0); border: 1px solid var(--acc-cyan); border-radius: 12px;
    padding: 8px 12px; font-size: 0.85rem; line-height: 1.45; color: var(--text);
  }
  .pet { position: relative; background: none; border: none; cursor: pointer; padding: 4px 12px; font-size: 4.2rem; line-height: 1.1; }
  .body { display: inline-block; transform-origin: 50% 100%; animation: breathe 3.4s ease-in-out infinite, look 11s steps(1) infinite; }
  .worn { position: absolute; top: -0.05em; left: 0.05em; font-size: 0.42em; transform: rotate(-14deg); pointer-events: none; }
  .hop .body { animation: hop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1); }
  @keyframes breathe { 50% { transform: scale(1.03, 0.97); } }
  /* Now and then it turns to look the other way, then back. */
  @keyframes look { 0%, 62% { scale: 1 1; } 66%, 74% { scale: -1 1; } 78% { scale: 1 1; } }
  @keyframes hop { 40% { transform: translateY(-18px) scale(1.08); } }
  .name { margin: 0; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text); }
  .mood { margin: 0; font-family: var(--font-mono); font-size: 0.72rem; color: var(--dim); }

  .trinkets { display: grid; grid-template-columns: repeat(5, 1fr); gap: 8px; }
  .trinket {
    aspect-ratio: 1; display: grid; place-items: center;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px; padding: 0;
    font-size: 1.5rem; line-height: 1; cursor: pointer;
  }
  .trinket.on { border-color: var(--acc-yellow); box-shadow: 0 0 0 1px var(--acc-yellow) inset; }
  .trinket.locked { color: var(--dim); font-family: var(--font-mono); font-size: 1.1rem; border-style: dashed; }
  .caption { margin: 8px 0 0; color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }

  .pages { display: grid; grid-template-columns: repeat(auto-fill, minmax(140px, 1fr)); gap: 8px; margin-top: 8px; }
  .page {
    display: flex; flex-direction: column; gap: 2px; text-align: left;
    background: var(--bg1); border: 1px dashed var(--line); border-radius: 10px; padding: 8px 10px;
    color: var(--dim); font-size: 0.72rem;
  }
  .page .title { font-family: var(--font-mono); font-size: 0.8rem; }
  .page.seen { border-style: solid; border-color: rgb(210 168 255 / 0.5); color: var(--text); cursor: pointer; }
  .page.seen .again { color: var(--acc-purple); }

  .links { display: flex; gap: 8px; flex-wrap: wrap; }
  .links button {
    background: none; border: 1px solid rgb(126 231 135 / 0.4); border-radius: 6px;
    color: var(--acc-green); font-family: var(--font-mono); font-size: 0.78rem; padding: 6px 10px; cursor: pointer;
  }
  @media (hover: hover) {
    .trinket:not(.locked):hover, .page.seen:hover { border-color: var(--acc-purple); }
  }
  @media (prefers-reduced-motion: reduce) {
    .body, .hop .body { animation: none; }
  }
</style>
