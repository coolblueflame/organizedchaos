<!-- Router shell: boot splash until the store hydrates, then the active screen. -->
<script lang="ts">
  import { app } from './lib/state/app.svelte';
  import { router } from './lib/ui/router.svelte';
  import Home from './lib/ui/Home.svelte';
  import ListView from './lib/ui/ListView.svelte';
  import SortView from './lib/ui/SortView.svelte';
  import CompletedView from './lib/ui/CompletedView.svelte';
  import RandomizerView from './lib/ui/RandomizerView.svelte';
  import InProgressView from './lib/ui/InProgressView.svelte';
  import RecurringView from './lib/ui/RecurringView.svelte';
  import UndoToast from './lib/ui/UndoToast.svelte';
</script>

{#if !app.ready}
  <main class="boot">
    <h1 class="wordmark">organized<span class="accent">chaos</span><span class="cursor">▊</span></h1>
  </main>
{:else}
  {@const r = router.current}
  {#if r.name === 'list'}
    <ListView id={r.id} />
  {:else if r.name === 'sort'}
    <SortView mode={r.mode} />
  {:else if r.name === 'completed'}
    <CompletedView />
  {:else if r.name === 'randomizer'}
    <RandomizerView listId={r.listId} />
  {:else if r.name === 'inprogress'}
    <InProgressView />
  {:else if r.name === 'recurring'}
    <RecurringView />
  {:else}
    <Home />
  {/if}
{/if}
<UndoToast />

<style>
  .boot { min-height: 100vh; display: grid; place-content: center; }
  .wordmark { font-family: var(--font-mono); font-size: 2rem; margin: 0; font-weight: 600; }
  .accent { color: var(--acc-purple); }
  .cursor { color: var(--acc-green); animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
</style>
