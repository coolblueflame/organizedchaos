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
    DEN_MARKS, SCRAPBOOK, SLOTS, SLOT_NAMES, TRINKETS, companionForm, costume, denOpen, outfit, wearPrefix,
    type WornSlot,
  } from './den';
  import { DEN_LINES, DEN_WAY_BACK, DEN_WELCOME } from './content/den';
  import { presenter } from './presenter.svelte';
  import DiceDuel from './DiceDuel.svelte';
  import { haptic } from '../ui/fx/haptics';
  import { clock } from '../ui/clock.svelte';
  import { SPARKLE_STORY_BEAT, sparkleTally } from './sparkles';
  import { seasonNow } from './seasonNow.svelte';
  import CompanionFigure from './CompanionFigure.svelte';
  import { RIDDLES, openRiddles, riddleSolved } from './riddles';
  import { ADVENT_DOORS, GIFTS, adventKey, doorsOpenable } from './advent';
  import Glyph from '../ui/Glyph.svelte';

  const lifetime = $derived(lifetimeCompletions(app.state.tasks));
  const open = $derived(denOpen(lifetime, app.eggMarks));
  const form = $derived(companionForm(lifetime));
  const progress = $derived({ unlocks: app.eggUnlocks, marks: app.eggMarks, lifetime });
  const fit = $derived(outfit(progress, seasonNow.current, seasonNow.day, app.state.settings.rolloverHour));

  /** One thing on the shelf: a trinket, or the season's costume while it lasts. */
  interface ShelfItem { id: string; emoji: string; slot: WornSlot; label: string; hint: string; earned: boolean }

  /** The shelf, a row per kind of thing; a kind with nothing in it is left out. */
  const shelf = $derived.by(() => {
    const season = seasonNow.current;
    return SLOTS.map((slot) => {
      const items: ShelfItem[] = TRINKETS.filter((t) => t.slot === slot).map((t) => ({
        id: t.id, emoji: t.emoji, slot, label: t.label, hint: t.hint, earned: t.earned(progress),
      }));
      const seasonal = season ? costume(season) : null;
      if (seasonal && seasonal.slot === slot) {
        items.push({ ...seasonal, label: 'this season’s costume', hint: '', earned: true });
      }
      return { slot, name: SLOT_NAMES[slot], items };
    }).filter((row) => row.items.length > 0);
  });
  const welcomed = $derived(app.eggMarks[DEN_MARKS.welcomed] !== undefined);
  const seen = $derived(MOMENTS.filter((m) => app.eggMarks[`moment:${m}`] !== undefined));
  const sparkles = $derived(sparkleTally(app.eggMarks));
  const riddles = $derived(openRiddles(app.eggMarks));
  const riddlesSolved = $derived(RIDDLES.filter((r) => riddleSolved(app.eggMarks, r.id)).length);
  const prizeOf = (id: string) => TRINKETS.find((t) => t.id === id)?.emoji ?? '';

  /** ENTROPY's winter calendar (see ./advent): on the wall only while it is winter. */
  const calendarUp = $derived(seasonNow.current === 'winter');
  const calendarYear = $derived(Number(seasonNow.day.slice(0, 4)));
  const openable = $derived(doorsOpenable(seasonNow.day));
  const doorOpen = (n: number) => app.eggMarks[adventKey(calendarYear, n)] !== undefined;
  const doorsDone = $derived(
    Array.from({ length: ADVENT_DOORS }, (_, i) => i + 1).filter((n) => doorOpen(n)).length);
  /** What the door tapped last had behind it. */
  let gift = $state('');

  /** Open a door (or look behind one again): its words, and its moment if it has one. */
  function openDoor(n: number) {
    if (!doorOpen(n)) {
      if (n > openable) return;
      haptic('success');
      app.markEgg(adventKey(calendarYear, n));
    }
    const g = GIFTS[n - 1]!;
    gift = g.text;
    if (g.moment) presenter.show({ kind: 'moment', moment: g.moment });
  }

  const mood = $derived.by(() => {
    const streak = app.eggStreak;
    if (streak >= 7) return `radiant. the flame is ${streak} days old.`;
    if (streak >= 3) return 'toasty. the flame is going nicely.';
    if (app.eggLastCompletionDay === appDayKey(clock.now, app.state.settings.rolloverHour)) {
      return 'content. the list got fed today.';
    }
    return 'cozy. waiting patiently, as companions do.';
  });

  // Walking in counts as opening the invitation, so it stops waiting in the
  // mailbox however the reader found the door.
  $effect(() => {
    if (open && app.eggsLoaded && app.eggMarks[DEN_MARKS.invited] === undefined) app.markEgg(DEN_MARKS.invited);
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

  /** Put something on in its spot, replacing what was there, or take it off if it is already on. */
  function wear(item: ShelfItem) {
    haptic('tick');
    const off = fit[item.slot]?.id === item.id;
    app.chooseEgg(wearPrefix(item.slot), off ? 'none' : item.id);
    caption = off ? `took off ${item.label}.` : `wearing ${item.label}.`;
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
    {#if app.eggsLoaded && !welcomed}
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
        <span class="body"><CompanionFigure form={form[1]} outfit={fit} testIdPrefix="den-worn" /></span>
      </button>
      <p class="name">{form[2]}</p>
      <p class="mood" data-testid="den-mood">mood: {mood}</p>
      {#if sparkles > 0 || app.eggStoryStage > SPARKLE_STORY_BEAT}
        <p class="mood" data-testid="den-sparkles">sparkles found: {sparkles}</p>
      {/if}
    </section>

    <DiceDuel />

    {#if calendarUp}
      <section class="calendar" data-testid="calendar">
        <h2>ENTROPY’s winter calendar <span class="count" data-testid="calendar-count">{doorsDone} of {ADVENT_DOORS}</span></h2>
        <div class="doors">
          {#each Array.from({ length: ADVENT_DOORS }, (_, i) => i + 1) as n (n)}
            <button class="door" class:open={doorOpen(n)} data-testid="door-{n}"
              disabled={!doorOpen(n) && n > openable}
              aria-label={doorOpen(n) ? `door ${n}, opened` : n > openable ? `door ${n}, not yet` : `open door ${n}`}
              onclick={() => openDoor(n)}>{n}</button>
          {/each}
        </div>
        <p class="dim" data-testid="calendar-gift">{gift || '// one door a day. a door you missed stays shut until you get to it.'}</p>
      </section>
    {/if}

    <section class="notebook" data-testid="notebook">
      <h2>ENTROPY’s notebook <span class="count" data-testid="notebook-count">{riddlesSolved} of {RIDDLES.length}</span></h2>
      <p class="dim">// answers go in the search bar. ENTROPY is watching it.</p>
      {#each riddles as r (r.id)}
        {@const solved = riddleSolved(app.eggMarks, r.id)}
        <div class="riddle" class:solved data-testid="riddle-{r.id}">
          <p>{r.text}</p>
          {#if solved}
            <p class="answer"><Glyph name="check" size={11} /> {r.answers[0]} <span class="prize">{prizeOf(r.reward)}</span></p>
          {/if}
        </div>
      {/each}
      {#if riddles.length < RIDDLES.length}
        <p class="dim">// {RIDDLES.length - riddles.length} more pages, stuck together.</p>
      {:else if riddlesSolved === RIDDLES.length}
        <p class="dim" data-testid="notebook-blank">// the last page is blank, with a pencil beside it. for whatever you want to figure out next.</p>
      {/if}
    </section>

    <section class="shelf">
      <h2>the shelf <span class="count">{TRINKETS.filter((t) => t.earned(progress)).length} of {TRINKETS.length}</span></h2>
      {#each shelf as row (row.slot)}
        <h3 class="kind">{row.name}</h3>
        <div class="trinkets">
          {#each row.items as t (t.id)}
            {#if t.earned}
              <button class="trinket" class:on={fit[t.slot]?.id === t.id} data-testid="trinket-{t.id}"
                aria-pressed={fit[t.slot]?.id === t.id} aria-label={t.label} onclick={() => wear(t)}>{t.emoji}</button>
            {:else}
              <button class="trinket locked" data-testid="trinket-{t.id}" aria-label="locked: {t.hint}"
                onclick={() => (caption = `locked: ${t.hint}.`)}>?</button>
            {/if}
          {/each}
        </div>
      {/each}
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
  .hop .body { animation: hop 0.5s cubic-bezier(0.3, 1.6, 0.5, 1); }
  @keyframes breathe { 50% { transform: scale(1.03, 0.97); } }
  /* Now and then it turns to look the other way, then back. */
  @keyframes look { 0%, 62% { scale: 1 1; } 66%, 74% { scale: -1 1; } 78% { scale: 1 1; } }
  @keyframes hop { 40% { transform: translateY(-18px) scale(1.08); } }
  .name { margin: 0; font-family: var(--font-mono); font-size: 0.8rem; color: var(--text); }
  .mood { margin: 0; font-family: var(--font-mono); font-size: 0.72rem; color: var(--dim); }

  .doors { display: grid; grid-template-columns: repeat(6, 1fr); gap: 6px; margin: 8px 0; }
  .door {
    aspect-ratio: 1; display: grid; place-items: center;
    background: var(--bg1); border: 1px solid var(--acc-cyan); border-radius: 8px;
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.85rem; cursor: pointer;
  }
  /* An opened door reads as lit from inside; a door not yet due, as shut. */
  .door.open { background: rgb(121 192 255 / 0.18); color: var(--text); border-style: solid; }
  .door:disabled { border-style: dashed; border-color: var(--line); color: var(--dim); cursor: default; }
  .calendar [data-testid='calendar-gift'] { min-height: 2.6em; }
  .notebook { display: flex; flex-direction: column; gap: 8px; }
  .riddle {
    background: var(--bg1); border: 1px dashed var(--line); border-radius: 10px; padding: 10px 12px;
  }
  .riddle p { margin: 0; font-size: 0.86rem; line-height: 1.5; }
  .riddle.solved { border-style: solid; border-color: rgb(210 168 255 / 0.5); }
  .riddle.solved > p:first-child { color: var(--dim); }
  .riddle .answer {
    margin-top: 6px; display: flex; align-items: center; gap: 6px;
    font-family: var(--font-mono); font-size: 0.78rem; color: var(--acc-purple);
  }
  .prize { font-size: 1rem; }
  .kind {
    margin: 10px 0 6px; font-family: var(--font-mono); font-size: 0.66rem; font-weight: 400;
    text-transform: uppercase; letter-spacing: 0.08em; color: var(--dim);
  }
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
