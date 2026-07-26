<!-- Completed history — fleshed out in P2.7. -->
<script lang="ts">
  import { navigate } from './router.svelte';
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>Completed</h1>
  </header>
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px; }
  header { display: flex; align-items: center; gap: 8px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
</style>
