<!--
  Daily rituals overview (#/rituals) — the day at a glance.

  Grouped by what matters right now, in that order: due (the window is open and
  it isn't done), waiting (later today or another day), done today. A ritual can
  be ticked off from here directly — including outside its window, because doing
  the thing early is still doing the thing; the window is when the app brings it
  up, not permission.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { describeRitual, ritualState } from '../domain/ritual';
  import type { Task } from '../domain/types';
  import Glyph from './Glyph.svelte';
  import TaskEditor from './TaskEditor.svelte';

  /*
    Tapping a ritual opens its full editor HERE, in a sheet — reported: a
    done-for-the-day ritual could only navigate to its list, leaving no way to
    move or reshape it from this screen at all. The list name in the meta line
    is the navigate affordance now.
  */
  let editingId = $state<string | null>(null);
  const editingTask = $derived(
    editingId ? app.state.tasks.find((t) => t.id === editingId) ?? null : null,
  );

  $effect(() => {
    if (editingId === null) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); editingId = null; }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const rituals = $derived(
    app.state.tasks.filter((t) => !t.deleted && t.ritual !== undefined),
  );

  const stateOf = (t: Task) => ritualState(t, new Date(), app.state.settings.rolloverHour);

  const due = $derived(rituals.filter((t) => stateOf(t) === 'due'));
  const waiting = $derived(rituals.filter((t) => stateOf(t) === 'waiting'));
  const done = $derived(rituals.filter((t) => stateOf(t) === 'done'));

  const listName = (id: string) => app.state.lists.find((l) => l.id === id)?.title ?? '';
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>Daily Rituals</h1>
  </header>

  {#snippet section(title: string, tasks: Task[], tone: string)}
    {#if tasks.length}
      <h2 class={tone}>{title}</h2>
      <section class="rows">
        {#each tasks as task (task.id)}
          <div class="row" data-testid="ritual-row-{task.id}">
            <button
              class="tick {tone}"
              data-testid="ritual-complete-{task.id}"
              disabled={stateOf(task) === 'done'}
              aria-label={stateOf(task) === 'done' ? 'done today' : 'mark done for today'}
              onclick={() => void app.completeTask(task.id)}>
              <Glyph name={stateOf(task) === 'done' ? 'box-checked' : 'box'} size={16} />
            </button>
            <button class="info" data-testid="ritual-edit-{task.id}" onclick={() => (editingId = task.id)}>
              <span class="name">{task.name || 'untitled'}</span>
              <span class="meta">{#if task.ritual}{describeRitual(task.ritual)}{/if}</span>
            </button>
            {#if listName(task.listId)}
              <button class="go-list" data-testid="ritual-list-{task.id}"
                onclick={() => navigate({ name: 'list', id: task.listId })}>
                {listName(task.listId)} ›
              </button>
            {/if}
          </div>
        {/each}
      </section>
    {/if}
  {/snippet}

  {@render section('due now', due, 'due')}
  {@render section('waiting for their window', waiting, 'waiting')}
  {@render section('done today', done, 'done')}

  {#if editingTask}
    <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
    <div class="backdrop" onclick={() => (editingId = null)}></div>
    <section class="sheet" data-testid="ritual-editor-sheet">
      <header class="sheet-head">
        <h2 class="sheet-name">{editingTask.name || 'untitled'}</h2>
        <button class="x" data-testid="ritual-editor-close" onclick={() => (editingId = null)} aria-label="close">✕</button>
      </header>
      <TaskEditor task={editingTask} oncollapse={() => (editingId = null)} />
    </section>
  {/if}

  {#if rituals.length === 0}
    <p class="empty">
      // no rituals yet — open any task and tap “make it a daily ritual”.<br />
      Good for the things a list shouldn't nag about: eat lunch, wind down, stretch.
    </p>
  {/if}
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  h2 {
    font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase;
    letter-spacing: 0.1em; margin: 16px 0 6px; font-weight: 600;
  }
  h2.due { color: var(--acc-magenta); }
  h2.waiting { color: var(--dim); }
  h2.done { color: var(--acc-green); }
  .rows { display: flex; flex-direction: column; gap: 6px; }
  .row {
    display: flex; align-items: center; gap: 10px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px;
    padding: 10px 12px;
  }
  .tick {
    flex: none; background: none; border: none; cursor: pointer; padding: 2px;
    display: inline-flex; align-items: center;
  }
  .tick.due { color: var(--acc-magenta); }
  .tick.waiting { color: var(--dim); }
  .tick.done { color: var(--acc-green); cursor: default; }
  .info {
    flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px;
    background: none; border: none; padding: 0; text-align: left;
    color: inherit; font: inherit; cursor: pointer;
  }
  .name { font-size: 0.9rem; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  @media (hover: hover) { .info:hover .name { color: var(--acc-cyan); } }
  .meta { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; }
  .go-list {
    flex: none; background: none; border: none; cursor: pointer; padding: 2px 4px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem;
    max-width: 34vw; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  @media (hover: hover) { .go-list:hover { color: var(--acc-blue); } }
  .backdrop { position: fixed; inset: 0; background: rgba(4, 6, 10, 0.6); z-index: 190; }
  .sheet {
    position: fixed; z-index: 200; left: 50%; transform: translateX(-50%);
    top: calc(12px + env(safe-area-inset-top));
    width: min(94vw, 560px);
    max-height: calc(100vh - 24px - env(safe-area-inset-top)); overflow-y: auto;
    background: var(--bg1); border: 1px solid var(--acc-purple); border-radius: 14px;
    padding: 14px; display: flex; flex-direction: column; gap: 10px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  }
  .sheet-head { display: flex; align-items: center; gap: 8px; }
  .sheet-name {
    flex: 1; min-width: 0; margin: 0; font-size: 1rem;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .x { background: none; border: none; color: var(--dim); font-size: 1rem; cursor: pointer; padding: 4px 8px; }
  @media (hover: hover) { .x:hover { color: var(--text); } }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; line-height: 1.7; margin-top: 20px; }
</style>
