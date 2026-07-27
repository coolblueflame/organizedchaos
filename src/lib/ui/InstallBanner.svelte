<!--
  A one-time nudge to install, shown only on devices that can actually do it.

  Deliberately an inline card at the top of Home rather than a floating bar:
  the bottom of the screen already belongs to the undo toast, the bulk-action
  bar and "+ new todo", and a fixed banner would sit on top of all three. This
  scrolls away with the page and can never intercept a tap.

  Dismissal is permanent — the how-to stays in Settings, and a banner that
  keeps coming back stops being a suggestion and becomes an ad.
-->
<script lang="ts">
  import { install } from './install.svelte';
</script>

{#if install.shouldOfferBanner}
  <div class="banner" data-testid="install-banner">
    <span class="text">
      📲 Put this on your home screen — full screen, offline, sturdier storage.
    </span>
    <button class="how" data-testid="install-banner-how" onclick={() => install.openHowTo()}>
      {install.canPromptDirectly ? 'install' : 'how?'}
    </button>
    <button class="x" data-testid="install-banner-dismiss"
      aria-label="dismiss" onclick={() => install.dismiss()}>✕</button>
  </div>
{/if}

<style>
  .banner {
    display: flex; align-items: center; gap: 8px;
    background: var(--bg2); border: 1px solid var(--acc-cyan); border-radius: 10px;
    padding: 8px 10px; margin-bottom: 10px;
  }
  .text {
    flex: 1; color: var(--text); font-family: var(--font-mono);
    font-size: 0.68rem; line-height: 1.35;
  }
  .how {
    flex: none; background: var(--acc-cyan); border: none; border-radius: 6px;
    color: var(--bg0); font-family: var(--font-mono); font-size: 0.68rem; font-weight: 700;
    padding: 5px 10px; cursor: pointer;
  }
  .x {
    flex: none; background: none; border: none; color: var(--dim);
    cursor: pointer; font-size: 0.7rem; padding: 2px 4px;
  }
</style>
