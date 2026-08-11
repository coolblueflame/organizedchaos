<script lang="ts">
  import { toast } from './toast.svelte';
</script>

{#if toast.current}
  <div class="toast" data-testid="undo-toast">
    <span>{toast.current.label}</span>
    {#if toast.current.extra}
      <button class="extra" data-testid="toast-extra"
        onclick={() => toast.runExtra()}>{toast.current.extra.label}</button>
    {/if}
    <button onclick={() => toast.undo()}>Undo</button>
  </div>
{/if}

<style>
  .toast {
    position: fixed;
    bottom: calc(16px + env(safe-area-inset-bottom));
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    align-items: center;
    gap: 16px;
    background: var(--bg2);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px 16px;
    font-family: var(--font-mono);
    font-size: 0.85rem;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
    z-index: 100;
  }
  button {
    background: none;
    border: none;
    color: var(--acc-cyan);
    font-family: var(--font-mono);
    font-size: 0.85rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0;
  }
  /* The rarer, more consequential choice reads quieter than Undo. */
  button.extra { color: var(--acc-orange); font-weight: 400; font-size: 0.78rem; }
</style>
