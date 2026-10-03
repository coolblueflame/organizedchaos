<!--
  The mailbox: where anything bigger than a passing note waits to be opened.

  The app is often opened for ten seconds to add one task. Nothing that wants
  the reader's full attention may stand in the way of that, so it is set
  aside here instead and opened when there is time. The chip shows only while
  something is waiting; tapping it lists what is.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import Glyph from '../ui/Glyph.svelte';
  import { navigate } from '../ui/router.svelte';
  import { lifetimeCompletions } from '../domain/stats';
  import { DEN_MARKS, denOpen } from './den';
  import { DEN_INVITE } from './content/den';
  import { seasonNow } from './seasonNow.svelte';
  import { SEASON_LOOKS } from './content/seasons';
  import { BIRTHDAY_ASK_AT, SEASON_MOMENTS, birthdayAnswered, seasonalEnabled } from './seasons';
  import BirthdayAsk from './BirthdayAsk.svelte';
  import { presenter } from './presenter.svelte';

  /** One waiting item: what the list shows, and what opening it does. */
  interface Waiting { id: string; from: string; subject: string; open: () => void }

  let sheetOpen = $state(false);
  /** ENTROPY's birthday question is open. */
  let asking = $state(false);

  const lifetime = $derived(lifetimeCompletions(app.state.tasks));

  const waiting = $derived.by((): Waiting[] => {
    const items: Waiting[] = [];
    if (app.eggStoryDeferred) {
      items.push({
        id: 'story', from: 'organizedchaos.exe', subject: 'a message, unread',
        open: () => app.openDeferredStory(),
      });
    }
    // The den's invitation: waits until the den is first visited, on any device.
    if (denOpen(lifetime, app.eggMarks) && app.eggMarks[DEN_MARKS.invited] === undefined) {
      items.push({ id: 'den', ...DEN_INVITE, open: () => navigate({ name: 'den' }) });
    }
    // ENTROPY's one birthday question, for a library that has settled in.
    // Part of the seasonal touches, so switching those off withdraws it.
    if (lifetime >= BIRTHDAY_ASK_AT && seasonalEnabled(app.eggMarks) && !birthdayAnswered(app.eggMarks)) {
      items.push({ id: 'birthday', from: 'ENTROPY', subject: 'a small question (it’s for a list)', open: () => (asking = true) });
    }
    // The season's letter: plays its moment, then says its piece.
    const season = seasonNow.current;
    const letterKey = seasonNow.letterKey;
    if (season && letterKey && app.eggMarks[letterKey] === undefined) {
      const look = SEASON_LOOKS[season];
      items.push({
        id: 'season', from: look.letter.from, subject: look.letter.subject,
        open: () => {
          app.markEgg(letterKey);
          presenter.show({ kind: 'moment', moment: SEASON_MOMENTS[season] });
          // Celebrated, so it waits behind the moment instead of being dropped.
          presenter.show({ kind: 'note', emoji: look.costume, accent: 'orange', celebrate: true, text: look.letter.text });
        },
      });
    }
    return items;
  });

  function openItem(item: Waiting) {
    sheetOpen = false;
    item.open();
  }

  $effect(() => {
    if (!sheetOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      sheetOpen = false;
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Nothing left to show: the sheet has no business staying open.
  $effect(() => { if (waiting.length === 0) sheetOpen = false; });
</script>

{#if waiting.length > 0}
  <button class="chip" data-testid="mailbox-chip" aria-label="{waiting.length} waiting in the mailbox"
    onclick={() => (sheetOpen = true)}>
    <Glyph name="mail" size={13} /><span class="count">{waiting.length}</span>
  </button>
{/if}

{#if sheetOpen}
  <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
  <div class="backdrop" onclick={() => (sheetOpen = false)}></div>
  <section class="sheet" data-testid="mailbox-sheet" aria-label="mailbox">
    <header>
      <h2>mailbox</h2>
      <button class="x" aria-label="close" onclick={() => (sheetOpen = false)}>✕</button>
    </header>
    <ul>
      {#each waiting as item (item.id)}
        <li>
          <button class="letter" data-testid="mailbox-item-{item.id}" onclick={() => openItem(item)}>
            <span class="from">{item.from}</span>
            <span class="subject">{item.subject}</span>
          </button>
        </li>
      {/each}
    </ul>
    <p class="hint">// these wait as long as you need them to.</p>
  </section>
{/if}

{#if asking}
  <BirthdayAsk onclose={() => (asking = false)} />
{/if}

<style>
  .chip {
    display: inline-flex; align-items: center; gap: 6px; flex: none;
    background: var(--bg1); border: 1px solid var(--acc-green); border-radius: 999px;
    color: var(--acc-green); font-family: var(--font-mono); font-size: 0.75rem;
    padding: 4px 10px; cursor: pointer;
  }
  @media (hover: hover) { .chip:hover { background: var(--bg2); } }
  .count { font-weight: 700; }

  .backdrop { position: fixed; inset: 0; background: rgba(4, 6, 10, 0.6); z-index: 190; }
  .sheet {
    position: fixed; z-index: 200; left: 50%; transform: translateX(-50%);
    top: calc(12px + env(safe-area-inset-top));
    width: min(94vw, 480px);
    background: var(--bg1); border: 1px solid var(--acc-green); border-radius: 14px;
    padding: 14px; display: flex; flex-direction: column; gap: 10px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  }
  header { display: flex; align-items: center; justify-content: space-between; }
  h2 {
    margin: 0; font-family: var(--font-mono); font-size: 0.75rem; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--acc-green);
  }
  .x { background: none; border: none; color: var(--dim); cursor: pointer; font-size: 0.9rem; padding: 2px 6px; }
  ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .letter {
    width: 100%; display: flex; flex-direction: column; align-items: flex-start; gap: 2px;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px; cursor: pointer; text-align: left; color: var(--text);
  }
  @media (hover: hover) { .letter:hover { border-color: var(--acc-green); } }
  .from { font-family: var(--font-mono); font-size: 0.7rem; color: var(--acc-green); }
  .subject { font-size: 0.9rem; }
  .hint { margin: 0; color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem; }
</style>
