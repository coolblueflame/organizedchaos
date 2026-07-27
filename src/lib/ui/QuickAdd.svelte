<!--
  Quick add: capture tasks from the home screen without ever leaving it.
  A draft task is created up front so the full editor works on it; leaving
  without typing anything discards it silently (spec §6 pristine rules).

  Enter (or "add another") commits the current one and immediately opens a
  fresh draft in the same list — the same rapid-entry rhythm as a list view.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import type { Task } from '../domain/types';
  import TaskEditor from './TaskEditor.svelte';

  let { onclose }: { onclose: () => void } = $props();

  // Default target: whatever quick add used last, else the first list.
  const initialListId =
    (app.state.settings.quickAddListId &&
      app.state.lists.some((l) => l.id === app.state.settings.quickAddListId)
      ? app.state.settings.quickAddListId
      : app.state.lists[0]?.id) ?? '';

  // svelte-ignore state_referenced_locally
  let listId = $state(initialListId);
  let draftId = $state<string | null>(null);
  let nameDraft = $state('');
  let nameEl = $state<HTMLInputElement | null>(null);
  let added = $state(0);
  let nameTimer: ReturnType<typeof setTimeout> | undefined;

  const draft = $derived(draftId ? app.state.tasks.find((t) => t.id === draftId) ?? null : null);

  /** In-flight draft creation, so early interactions can wait for it. */
  let creating: Promise<void> | null = null;

  function startDraft(): Promise<void> {
    creating = openDraft();
    return creating;
  }

  async function openDraft(): Promise<void> {
    if (!listId) return;
    // Clear BEFORE awaiting: the field is live immediately, and anything typed
    // while the draft is still being created must not be wiped when it lands.
    nameDraft = '';
    const task = await app.addTask(listId);
    draftId = task.id;
    queueMicrotask(() => nameEl?.focus());
  }

  function queueNameSave(): void {
    clearTimeout(nameTimer);
    // First real keystroke saves at once so the draft stops looking pristine.
    if (draft?.name === '' && nameDraft.trim() !== '') {
      void flushName();
      return;
    }
    nameTimer = setTimeout(() => void flushName(), 400);
  }

  async function flushName(): Promise<void> {
    clearTimeout(nameTimer);
    // Typing can outrun draft creation (fast fingers, slow device) — without
    // this the name would be written to nothing and then cleared.
    if (creating) await creating;
    if (draftId && draft && nameDraft !== draft.name) {
      await app.patchTask(draftId, { name: nameDraft });
    }
  }

  /** Commit this one and open the next; an empty one just ends the session. */
  async function addAnother(): Promise<void> {
    await flushName();
    if (!nameDraft.trim()) {
      await close();
      return;
    }
    added += 1;
    draftId = null;
    await startDraft();
  }

  async function close(): Promise<void> {
    await flushName(); // waits for any in-flight draft itself
    const id = draftId;
    draftId = null;
    if (id) await app.discardIfPristine(id);
    onclose();
  }

  async function changeList(next: string): Promise<void> {
    listId = next;
    await app.updateSettings({ quickAddListId: next });
    // The draft may still be in flight — wait, or the switch silently misses it
    // and the task lands in the previous list.
    if (creating) await creating;
    if (draftId) await app.patchTask(draftId, { listId: next });
  }

  function onNameKey(e: KeyboardEvent): void {
    if (e.key === 'Enter') {
      e.preventDefault();
      void addAnother();
    }
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        void close();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  // Create the first draft once, on open. Deliberately NOT reactive on draftId:
  // addAnother() opens the next one itself, and a reactive effect would race it
  // into creating a second, orphaned draft.
  let started = false;
  $effect(() => {
    if (started) return;
    started = true;
    void startDraft();
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={() => void close()}></div>

<section class="sheet" data-testid="quick-add">
  <header>
    <span class="title">quick add{#if added > 0}&nbsp;<span class="added">· {added} added</span>{/if}</span>
    <button class="x" data-testid="quick-add-close" onclick={() => void close()} aria-label="close">✕</button>
  </header>

  <label class="target">
    <span class="target-label">into</span>
    <select data-testid="quick-add-list" value={listId}
      onchange={(e) => void changeList(e.currentTarget.value)}>
      {#each app.state.lists as l (l.id)}
        <option value={l.id}>{l.title}</option>
      {/each}
    </select>
  </label>

  <input
    class="name"
    data-testid="quick-add-name"
    placeholder="what needs doing?"
    bind:this={nameEl}
    bind:value={nameDraft}
    oninput={queueNameSave}
    onkeydown={onNameKey} />

  {#if draft}
    <TaskEditor task={draft} compact oncollapse={() => void addAnother()} />
  {/if}

  <div class="actions">
    <button class="primary" data-testid="quick-add-another" onclick={() => void addAnother()}>
      + add another
    </button>
    <button data-testid="quick-add-done" onclick={() => void close()}>done</button>
  </div>
  <p class="hint">enter adds another · esc or tapping away finishes</p>
</section>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(4, 6, 10, 0.6); z-index: 190; }
  .sheet {
    position: fixed; z-index: 200;
    left: 50%; transform: translateX(-50%);
    top: calc(12px + env(safe-area-inset-top));
    width: min(94vw, 560px);
    max-height: calc(100vh - 24px - env(safe-area-inset-top));
    overflow-y: auto;
    background: var(--bg1); border: 1px solid var(--acc-green); border-radius: 14px;
    padding: 14px; display: flex; flex-direction: column; gap: 10px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
    animation: sheet-in 0.22s cubic-bezier(0.2, 1.2, 0.4, 1);
  }
  @keyframes sheet-in { from { opacity: 0; transform: translate(-50%, -12px); } }
  header { display: flex; align-items: center; justify-content: space-between; }
  .title {
    color: var(--acc-green); font-family: var(--font-mono); font-size: 0.72rem;
    text-transform: uppercase; letter-spacing: 0.1em;
  }
  .added { color: var(--dim); }
  .x { background: none; border: none; color: var(--dim); cursor: pointer; font-size: 0.9rem; padding: 2px 6px; }
  .x:hover { color: var(--text); }
  .target { display: flex; align-items: center; gap: 8px; }
  .target-label { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  select {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-size: 0.85rem; padding: 7px 8px;
  }
  .name {
    background: none; border: none; border-bottom: 1px solid var(--acc-blue);
    color: var(--text); font-size: 1.05rem; padding: 8px 2px; outline: none;
  }
  .name::placeholder { color: var(--dim); }
  .actions { display: flex; gap: 8px; }
  .actions button {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.85rem;
    padding: 11px; cursor: pointer;
  }
  .actions .primary { color: var(--acc-green); border-color: var(--acc-green); font-weight: 700; }
  .hint { color: var(--dim); font-family: var(--font-mono); font-size: 0.65rem; text-align: center; margin: 0; }
</style>
