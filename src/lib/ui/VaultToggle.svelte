<!--
  One-tap vault control (2026-08-20 ask): a padlock button that unlocks the
  PIN-protected lists BEFORE rolling — or re-locks them on the way out.
  Renders only when there is something to guard (a locked list and a PIN).
  Tapping while locked opens the shared LockGate inline; tapping while open
  re-locks instantly, no ceremony — locking should always be the easy
  direction.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { hasPin, lock } from './lock.svelte';
  import LockGate from './LockGate.svelte';
  import Glyph from './Glyph.svelte';

  let { onchange }: { onchange?: () => void } = $props();

  const hasVaults = $derived(
    hasPin() && app.state.lists.some((l) => !l.deleted && l.locked === true));

  let gateOpen = $state(false);

  function tap() {
    if (lock.unlocked) {
      lock.relock();
      app.grantUnlockAndShow('bouncer');
      onchange?.();
    } else {
      gateOpen = !gateOpen;
    }
  }
</script>

{#if hasVaults}
  <button class="vault" class:open={lock.unlocked} data-testid="vault-toggle"
    aria-label={lock.unlocked ? 'lock your vaults' : 'unlock your vaults'}
    title={lock.unlocked ? 'vaults are open — tap to lock' : 'vaults are locked — tap to unlock'}
    onclick={tap}>
    <Glyph name={lock.unlocked ? 'unlocked' : 'locked'} size={14} />
  </button>
{/if}
{#if gateOpen && !lock.unlocked}
  <div class="vault-gate" data-testid="vault-gate">
    <LockGate
      onunlocked={() => { gateOpen = false; onchange?.(); }}
      oncancel={() => (gateOpen = false)} />
  </div>
{/if}

<style>
  .vault {
    display: inline-flex; align-items: center; justify-content: center;
    background: var(--bg1); border: 1px solid var(--acc-yellow); border-radius: 8px;
    color: var(--acc-yellow); cursor: pointer; padding: 6px 10px; flex: none;
  }
  .vault.open { border-color: var(--line); color: var(--dim); }
  @media (hover: hover) { .vault:hover { border-color: var(--acc-yellow); color: var(--acc-yellow); } }
  /* A floating sheet, because the button lives inside header/nav flex rows
     that must not reflow around a PIN pad. */
  .vault-gate {
    position: fixed; z-index: 130; left: 50%; transform: translateX(-50%);
    top: 18vh; width: min(94vw, 380px);
    filter: drop-shadow(0 12px 32px rgb(0 0 0 / 0.55));
  }
</style>
