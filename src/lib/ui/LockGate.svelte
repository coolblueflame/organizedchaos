<!--
  The PIN prompt for locked lists — rendered inline wherever a locked surface
  needs opening (ListView's gate, Home's sheet). One successful entry unlocks
  the whole session.
-->
<script lang="ts">
  import { focusOnMount } from './focusOnMount';
  import Glyph from './Glyph.svelte';
  import { tryUnlock } from './lock.svelte';

  let { onunlocked, oncancel }: { onunlocked?: () => void; oncancel?: () => void } = $props();

  let pin = $state('');
  let wrong = $state(false);

  async function submit() {
    if (!pin) return;
    if (await tryUnlock(pin)) {
      pin = '';
      onunlocked?.();
    } else {
      wrong = true;
      pin = '';
    }
  }
</script>

<div class="gate" data-testid="lock-gate">
  <span class="label"><Glyph name="locked" size={11} /> locked — enter your PIN</span>
  <div class="row">
    <input type="password" inputmode="numeric" autocomplete="off"
      data-testid="lock-pin-input" use:focusOnMount bind:value={pin}
      oninput={() => (wrong = false)}
      onkeydowncapture={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void submit(); } }} />
    <button data-testid="lock-unlock" onclick={() => void submit()}>unlock</button>
    {#if oncancel}<button class="cancel" onclick={oncancel}>cancel</button>{/if}
  </div>
  {#if wrong}<span class="wrong" data-testid="lock-wrong">that's not it</span>{/if}
</div>

<style>
  .gate {
    display: flex; flex-direction: column; gap: 8px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px; padding: 14px;
  }
  .label { color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem;
    display: inline-flex; align-items: center; gap: 6px; }
  .row { display: flex; gap: 8px; }
  input {
    flex: 1; min-width: 0; background: var(--bg2); border: 1px solid var(--line);
    border-radius: 8px; color: var(--text); padding: 8px 10px; font-family: var(--font-mono);
  }
  button {
    background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 8px;
    color: var(--acc-green); font-family: var(--font-mono); padding: 8px 12px; cursor: pointer;
  }
  .cancel { border-color: var(--line); color: var(--dim); }
  .wrong { color: var(--acc-magenta); font-family: var(--font-mono); font-size: 0.75rem; }
</style>
