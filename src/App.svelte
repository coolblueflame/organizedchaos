<!-- Router shell: boot splash until the store hydrates, then the active screen. -->
<script lang="ts">
  import { app } from './lib/state/app.svelte';
  import { liveRoute, navigate, router } from './lib/ui/router.svelte';
  import { nextRolloverTs } from './lib/domain/time';
  import { toast } from './lib/ui/toast.svelte';
  import { searchQuery } from './lib/ui/searchState.svelte';
  import { checkTimeboxes } from './lib/ui/timeboxWatch.svelte';
  import { syncAlarms } from './lib/state/alarmPush.svelte';

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
  import SearchView from './lib/ui/SearchView.svelte';
  import TagsView from './lib/ui/TagsView.svelte';
  import RitualsView from './lib/ui/RitualsView.svelte';
  import WeekReviewView from './lib/ui/WeekReviewView.svelte';
  import WrappedView from './lib/ui/WrappedView.svelte';
  import SweepView from './lib/ui/SweepView.svelte';
  import UndoToast from './lib/ui/UndoToast.svelte';
  import InstallHowTo from './lib/ui/InstallHowTo.svelte';
  import { install } from './lib/ui/install.svelte';
  import FxLayer from './lib/ui/fx/FxLayer.svelte';
  import DelightLayer from './lib/eggs/DelightLayer.svelte';

  // Screen visits feed the delight layer (throttled internally by the engine).
  $effect(() => {
    if (app.ready) app.fireEgg('screenVisited', { screen: router.current.name });
  });

  /*
    The timebox alarm lives HERE, not on the current-task card that draws the
    countdown: that card only exists on home, so walking to any other screen
    used to unmount the timer and the alert never fired (2026-08-03 report).
    The visibility hook is the catch-up — iOS freezes our timers while the app
    is away, so a box that ran out in a pocket announces itself on return.
  */
  $effect(() => {
    if (!app.ready) return;
    const sweep = () => {
      checkTimeboxes(app.state.tasks, app.state.lists, () => app.fireEgg('timeboxFinished'));
      // The remote half rides the same beat: a cheap diff that almost always
      // sends nothing, and is a no-op entirely until Settings configures it.
      void syncAlarms(app.state.tasks, app.state.lists, app.state.settings);
    };
    const onVisible = () => { if (document.visibilityState === 'visible') sweep(); };
    const id = setInterval(sweep, 1000);
    document.addEventListener('visibilitychange', onVisible);
    sweep();
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
    };
  });

  // Keyboard: Cmd/Ctrl+Z undoes the last consequential action long after its
  // toast is gone; "/" and Cmd/Ctrl+K jump to search.
  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      const typing = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;

      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        if (typing) return; // let text fields keep their own native undo
        e.preventDefault();
        void app.undoLast().then((label) => {
          if (label) toast.show(`Undid: ${label}`, () => {});
        });
        return;
      }

      const wantsSearch = (!typing && e.key === '/') ||
        ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k');
      if (wantsSearch) {
        e.preventDefault();
        // A shortcut from anywhere else starts a NEW search; on the search
        // screen itself it just refocuses and must not eat what was typed.
        // liveRoute, not router.current: right after a navigate the mirrored
        // route is still the OLD screen (hashchange is async).
        if (liveRoute().name !== 'search') searchQuery.beginFresh();
        navigate({ name: 'search' });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
</script>

{#if !app.ready}
  <main class="boot">
    <h1 class="wordmark">organized<span class="accent">chaos</span><span class="cursor">▊</span></h1>
  </main>
{:else}
  {@const r = router.current}
  <!-- {#key} on every parameterized screen: two adjacent routes of the same
       kind (list A → list B) would otherwise REUSE the component instance,
       carrying one screen's local state — drafts, scroll, open editors —
       into the other. No such adjacency is reachable today, which is exactly
       why this stayed latent; the key makes the next new link safe by default. -->
  {#if r.name === 'list'}
    {#key r.id}
      <ListView id={r.id} revealTaskId={r.taskId} />
    {/key}
  {:else if r.name === 'sort'}
    {#key r.mode}
      <SortView mode={r.mode} />
    {/key}
  {:else if r.name === 'completed'}
    <CompletedView />
  {:else if r.name === 'randomizer'}
    {#key r.listId}
      <RandomizerView listId={r.listId} />
    {/key}
  {:else if r.name === 'inprogress'}
    <InProgressView />
  {:else if r.name === 'recurring'}
    {#key r.tplId}
      <RecurringView revealId={r.tplId} />
    {/key}
  {:else if r.name === 'settings'}
    <SettingsView />
  {:else if r.name === 'import'}
    <ImportView />
  {:else if r.name === 'stats'}
    <StatsView />
  {:else if r.name === 'search'}
    <SearchView />
  {:else if r.name === 'tags'}
    <TagsView />
  {:else if r.name === 'rituals'}
    <RitualsView />
  {:else if r.name === 'week'}
    <WeekReviewView />
  {:else if r.name === 'wrapped'}
    <WrappedView />
  {:else if r.name === 'sweep'}
    <SweepView />
  {:else}
    <Home />
  {/if}
{/if}
<UndoToast />
<!-- Mounted app-wide, not with the banner: Settings can open it long after
     the banner has been dismissed. -->
{#if install.howToOpen}
  <InstallHowTo onclose={() => (install.howToOpen = false)} />
{/if}
<DelightLayer />
<FxLayer />

<style>
  /* Minus the insets body now pays: a bare 100vh would overflow by exactly
     the height of the status bar and leave the splash scrollable. */
  .boot {
    min-height: calc(100vh - env(safe-area-inset-top) - env(safe-area-inset-bottom));
    display: grid; place-content: center;
  }
  .wordmark { font-family: var(--font-mono); font-size: 2rem; margin: 0; font-weight: 600; }
  .accent { color: var(--acc-purple); }
  .cursor { color: var(--acc-green); animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
</style>
