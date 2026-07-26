<!-- Router shell: boot splash until the store hydrates, then the active screen. -->
<script lang="ts">
  import { app } from './lib/state/app.svelte';
  import { router } from './lib/ui/router.svelte';
  import { nextRolloverTs } from './lib/domain/time';

  // Spawn-sweep triggers beyond init (spec §5): returning to the app, and the
  // 4am rollover while it stays open. The timer re-arms itself each rollover.
  $effect(() => {
    if (!app.ready) return;
    const onVisible = () => {
      if (document.visibilityState === 'visible') {
        void app.runSpawnSweep();
        void app.syncNow(); // returning to the app pulls other devices' changes (spec §8)
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    let timer: ReturnType<typeof setTimeout>;
    const arm = () => {
      const delay = Math.max(1000, nextRolloverTs(Date.now(), app.state.settings.rolloverHour) - Date.now());
      timer = setTimeout(() => {
        void app.runSpawnSweep();
        arm();
      }, delay);
    };
    arm();
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      clearTimeout(timer);
    };
  });
  import Home from './lib/ui/Home.svelte';
  import ListView from './lib/ui/ListView.svelte';
  import SortView from './lib/ui/SortView.svelte';
  import CompletedView from './lib/ui/CompletedView.svelte';
  import RandomizerView from './lib/ui/RandomizerView.svelte';
  import InProgressView from './lib/ui/InProgressView.svelte';
  import RecurringView from './lib/ui/RecurringView.svelte';
  import SettingsView from './lib/ui/SettingsView.svelte';
  import ImportView from './lib/ui/ImportView.svelte';
  import StatsView from './lib/ui/StatsView.svelte';
  import UndoToast from './lib/ui/UndoToast.svelte';
  import FxLayer from './lib/ui/fx/FxLayer.svelte';
  import DelightLayer from './lib/eggs/DelightLayer.svelte';

  // Screen visits feed the delight layer (throttled internally by the engine).
  $effect(() => {
    if (app.ready) app.fireEgg('screenVisited', { screen: router.current.name });
  });
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
  {:else if r.name === 'settings'}
    <SettingsView />
  {:else if r.name === 'import'}
    <ImportView />
  {:else if r.name === 'stats'}
    <StatsView />
  {:else}
    <Home />
  {/if}
{/if}
<UndoToast />
<DelightLayer />
<FxLayer />

<style>
  .boot { min-height: 100vh; display: grid; place-content: center; }
  .wordmark { font-family: var(--font-mono); font-size: 2rem; margin: 0; font-weight: 600; }
  .accent { color: var(--acc-purple); }
  .cursor { color: var(--acc-green); animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
</style>
