<!--
  SPOILER ZONE — ENTROPY asks, once and politely, when the reader's birthday
  is. Month and day only, never a year. Either answer is final until changed
  in Settings: "no thanks" is remembered exactly as firmly as a date.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { birthdayKey } from './seasons';
  import { presenter } from './presenter.svelte';
  import BirthdayPicker from './BirthdayPicker.svelte';

  let { onclose }: { onclose: () => void } = $props();

  let month = $state(1);
  let day = $state(1);

  function save() {
    app.markEgg(birthdayKey({ month, day }), Date.now());
    onclose();
    presenter.show({ kind: 'note', emoji: '🎈', accent: 'orange', text: 'noted. ENTROPY has drawn a very small circle on the calendar. it keeps looking at it.' });
  }

  function decline() {
    app.markEgg(birthdayKey(null), Date.now());
    onclose();
    presenter.show({ kind: 'note', emoji: '💜', accent: 'orange', text: 'no problem at all. ENTROPY will just have to celebrate you on ordinary days instead.' });
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      onclose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>
<section class="sheet" data-testid="birthday-ask" aria-label="a question from ENTROPY">
  <p class="from">▚ ENTROPY</p>
  <p>can I ask you something? when is your birthday? I would like to make a fuss. just the month and day, no year. it is kept with your lists and nowhere else, and you can change it or take it back in settings.</p>
  <BirthdayPicker bind:month bind:day />
  <div class="moves">
    <button class="primary" data-testid="birthday-save" onclick={save}>that’s my birthday</button>
    <button data-testid="birthday-decline" onclick={decline}>no thanks</button>
  </div>
  <button class="later" data-testid="birthday-later" onclick={onclose}>ask me later</button>
</section>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(4, 6, 10, 0.6); z-index: 190; }
  .sheet {
    position: fixed; z-index: 200; left: 50%; transform: translateX(-50%);
    top: calc(12px + env(safe-area-inset-top));
    width: min(94vw, 480px);
    background: var(--bg1); border: 1px solid var(--acc-green); border-radius: 14px;
    padding: 16px; display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6); font-size: 0.9rem; line-height: 1.5;
  }
  .sheet p { margin: 0; }
  .from { font-family: var(--font-mono); font-size: 0.72rem; color: var(--acc-green); }
  .moves { display: flex; gap: 8px; flex-wrap: wrap; }
  button {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px; color: var(--text);
    font-family: var(--font-mono); font-size: 0.85rem; padding: 8px 14px; cursor: pointer;
  }
  .primary { border-color: var(--acc-green); color: var(--acc-green); }
  .later { align-self: flex-start; background: none; border: none; color: var(--dim); padding: 0; font-size: 0.75rem; }
</style>
