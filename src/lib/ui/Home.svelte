<!--
  Home screen (spec §6). This phase: sort-view row, grouped lists with CRUD,
  completed link. Phase 3 adds the big randomizer button + current task card
  here; Phase 8 adds the stats strip above everything.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { toast } from './toast.svelte';
  import { openTasks } from '../domain/views';
  import type { List } from '../domain/types';
  import { nextPhrase } from './phrases';
  import CurrentTaskCard from './CurrentTaskCard.svelte';
  import { haptic } from './fx/haptics';

  const phrase = nextPhrase();

  function bigButton() {
    haptic('tick');
    navigate({ name: 'randomizer' });
  }

  let newListOpen = $state(false);
  let newListInput = $state<HTMLInputElement | null>(null);
  let newListTitle = $state('');
  let menuFor = $state<string | null>(null);
  let renamingId = $state<string | null>(null);
  let editText = $state('');
  let regroupingId = $state<string | null>(null);

  const open = $derived(openTasks(app.state.tasks));
  const countFor = (listId: string) => open.filter((t) => t.listId === listId).length;
  const inProgressCount = $derived(open.filter((t) => t.inProgress).length);
  const recurringCount = $derived(app.state.templates.filter((t) => !t.deleted).length);

  /** Lists bucketed by areaGroup: ungrouped first, then groups alphabetically. */
  const grouped = $derived.by(() => {
    const buckets = new Map<string, List[]>();
    for (const l of app.state.lists) {
      const key = l.areaGroup?.trim() ?? '';
      const bucket = buckets.get(key) ?? [];
      bucket.push(l);
      buckets.set(key, bucket);
    }
    return [...buckets.entries()].sort(([a], [b]) =>
      a === '' ? -1 : b === '' ? 1 : a.localeCompare(b));
  });

  async function createList() {
    const title = newListTitle.trim();
    if (!title) { newListOpen = false; return; }
    const list = await app.addList(title);
    newListTitle = '';
    newListOpen = false;
    navigate({ name: 'list', id: list.id });
  }

  function startRename(l: List) {
    renamingId = l.id;
    editText = l.title;
    menuFor = null;
  }

  async function finishRename() {
    if (renamingId && editText.trim()) await app.renameList(renamingId, editText.trim());
    renamingId = null;
  }

  function startRegroup(l: List) {
    regroupingId = l.id;
    editText = l.areaGroup ?? '';
    menuFor = null;
  }

  async function finishRegroup() {
    if (regroupingId) await app.regroupList(regroupingId, editText.trim() || undefined);
    regroupingId = null;
  }

  async function deleteList(l: List) {
    menuFor = null;
    if (!window.confirm(`Delete "${l.title}" and its open tasks?`)) return;
    const id = l.id;
    const taskIds = await app.removeList(id);
    toast.show('List deleted', () => void app.restoreList(id, taskIds));
  }

  $effect(() => {
    if (newListOpen) newListInput?.focus();
  });
</script>

<main>
  <h1 class="wordmark">organized<span class="accent">chaos</span><span class="cursor">▊</span></h1>
  <p class="tagline">// a todo list with a gambling problem</p>

  <!-- Phase 8: stats strip mounts above the wordmark. -->

  <CurrentTaskCard />

  <button class="big-button" data-testid="big-button" onclick={bigButton}>
    {phrase}
  </button>

  <nav class="sort-row">
    <button data-testid="sort-date" onclick={() => navigate({ name: 'sort', mode: 'date' })}>by date</button>
    <button data-testid="sort-priority" onclick={() => navigate({ name: 'sort', mode: 'priority' })}>by priority</button>
    <button data-testid="sort-tag" onclick={() => navigate({ name: 'sort', mode: 'tag' })}>by tag</button>
  </nav>

  <section class="lists">
    {#each grouped as [group, lists] (group)}
      {#if group !== ''}
        <h2 class="group-header">{group}</h2>
      {/if}
      {#each lists as l (l.id)}
        <div class="list-row" data-testid="list-row-{l.id}">
          {#if renamingId === l.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="inline-edit" autofocus bind:value={editText}
              onblur={finishRename}
              onkeydown={(e) => { if (e.key === 'Enter') finishRename(); if (e.key === 'Escape') renamingId = null; }} />
          {:else if regroupingId === l.id}
            <!-- svelte-ignore a11y_autofocus -->
            <input class="inline-edit" autofocus bind:value={editText} placeholder="group name (empty = none)"
              onblur={finishRegroup}
              onkeydown={(e) => { if (e.key === 'Enter') finishRegroup(); if (e.key === 'Escape') regroupingId = null; }} />
          {:else}
            <button class="list-main" onclick={() => navigate({ name: 'list', id: l.id })}>
              <span class="list-title">{l.title}</span>
              <span class="count">{countFor(l.id)}</span>
            </button>
            <button class="menu-btn" data-testid="list-menu-{l.id}"
              onclick={() => (menuFor = menuFor === l.id ? null : l.id)}>⋯</button>
            {#if menuFor === l.id}
              <div class="menu">
                <button onclick={() => startRename(l)}>Rename</button>
                <button onclick={() => startRegroup(l)}>Group…</button>
                <button class="danger" data-testid="list-delete-{l.id}" onclick={() => deleteList(l)}>Delete</button>
              </div>
            {/if}
          {/if}
        </div>
      {/each}
    {/each}

    {#if newListOpen}
      <input class="inline-edit new-list-input" data-testid="new-list-input"
        bind:this={newListInput} bind:value={newListTitle} placeholder="list name"
        onblur={createList}
        onkeydown={(e) => { if (e.key === 'Enter') createList(); if (e.key === 'Escape') { newListOpen = false; newListTitle = ''; } }} />
    {:else}
      <button class="new-list" data-testid="new-list" onclick={() => (newListOpen = true)}>+ new list</button>
    {/if}
  </section>

  <div class="footer-links">
    <button data-testid="inprogress-link" onclick={() => navigate({ name: 'inprogress' })}>
      ▶ In Progress{#if inProgressCount > 0}&nbsp;({inProgressCount}){/if}
    </button>
    <button data-testid="recurring-link" onclick={() => navigate({ name: 'recurring' })}>
      ↻ Recurring{#if recurringCount > 0}&nbsp;({recurringCount}){/if}
    </button>
    <button data-testid="completed-link" onclick={() => navigate({ name: 'completed' })}>
      ✓ Completed
    </button>
    <button data-testid="settings-link" onclick={() => navigate({ name: 'settings' })}>
      ⚙ Settings{#if app.syncStatus === 'error' || app.syncStatus === 'offline'}&nbsp;<span class="sync-warn">●</span>{/if}
    </button>
  </div>
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  .wordmark { font-family: var(--font-mono); font-size: 1.5rem; margin: 0; font-weight: 600; }
  .accent { color: var(--acc-purple); }
  .cursor { color: var(--acc-green); animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .tagline { color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; margin: 4px 0 20px; }

  .sort-row { display: flex; gap: 8px; margin-bottom: 20px; }
  .sort-row button {
    flex: 1; background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--acc-blue); font-family: var(--font-mono); font-size: 0.8rem;
    padding: 8px 0; cursor: pointer;
  }
  .sort-row button:hover { background: var(--bg2); }

  .lists { display: flex; flex-direction: column; gap: 6px; }
  .group-header {
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 14px 0 2px; font-weight: 600;
  }
  .list-row { position: relative; display: flex; align-items: stretch; }
  .list-main {
    flex: 1; display: flex; justify-content: space-between; align-items: center;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); padding: 14px; font-size: 0.95rem; cursor: pointer; text-align: left;
  }
  .list-main:hover { background: var(--bg2); }
  .list-title { font-weight: 500; }
  .count { color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; }
  .menu-btn {
    background: none; border: none; color: var(--dim); font-size: 1.1rem;
    cursor: pointer; padding: 0 10px;
  }
  .menu {
    position: absolute; right: 0; top: 100%; z-index: 10;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    display: flex; flex-direction: column; min-width: 130px; overflow: hidden;
    box-shadow: 0 4px 24px rgba(0, 0, 0, 0.5);
  }
  .menu button {
    background: none; border: none; color: var(--text); padding: 10px 14px;
    text-align: left; cursor: pointer; font-size: 0.85rem;
  }
  .menu button:hover { background: var(--bg1); }
  .menu .danger { color: var(--acc-magenta); }

  .inline-edit {
    flex: 1; background: var(--bg2); border: 1px solid var(--acc-blue); border-radius: 8px;
    color: var(--text); padding: 14px; font-size: 0.95rem; outline: none;
  }
  .new-list {
    background: none; border: 1px dashed var(--line); border-radius: 8px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem;
    padding: 12px; cursor: pointer; text-align: left;
  }
  .new-list:hover { color: var(--acc-green); border-color: var(--acc-green); }

  .big-button {
    width: 100%; margin-bottom: 20px; padding: 22px 12px;
    background: linear-gradient(135deg, var(--bg2), var(--bg1));
    border: 1px solid var(--acc-purple); border-radius: 14px;
    color: var(--acc-purple); font-family: var(--font-mono);
    font-size: 1.15rem; font-weight: 700; cursor: pointer;
    transition: transform 0.1s ease, box-shadow 0.15s ease;
  }
  .big-button:hover { transform: scale(1.015); box-shadow: 0 0 24px rgba(210, 168, 255, 0.25); }
  .big-button:active { transform: scale(0.985); }
  @media (prefers-reduced-motion: no-preference) {
    .big-button { position: relative; overflow: hidden; }
    .big-button::after {
      content: ''; position: absolute; inset: 0; pointer-events: none;
      background: linear-gradient(105deg, transparent 38%,
        rgba(121, 192, 255, 0.10) 45%, rgba(210, 168, 255, 0.28) 50%,
        rgba(126, 231, 135, 0.10) 55%, transparent 62%);
      transform: translateX(-130%);
      animation: big-shimmer 7s ease-in-out infinite 2s;
    }
    @keyframes big-shimmer {
      0% { transform: translateX(-130%); }
      13% { transform: translateX(130%); }
      100% { transform: translateX(130%); }
    }
  }

  .footer-links { margin-top: 24px; display: flex; flex-direction: column; }
  .footer-links button {
    width: 100%; background: none; border: none;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem;
    padding: 10px; cursor: pointer; text-align: left;
  }
  .footer-links button:hover { color: var(--acc-green); }
  .sync-warn { color: var(--acc-orange); }
</style>
