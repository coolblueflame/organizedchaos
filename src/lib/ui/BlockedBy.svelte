<!--
  "Blocked by" editor (2026-07-27 request): type a task name, pick from the
  matches, and this task drops out of the randomizer until those are done.

  Two rules the picker enforces so bad states are unreachable rather than
  merely detected: a finished task is never offered (it would block nothing),
  and neither is anything that already waits on THIS task, which would make a
  loop. Blockers already chosen stay listed even once complete, so the row
  reads as a history of what this was waiting on.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { wouldCycle } from '../domain/blocking';
  import Glyph from './Glyph.svelte';
  import type { Task } from '../domain/types';

  let { task }: { task: Task } = $props();

  let query = $state('');
  let open = $state(false);
  let input = $state<HTMLInputElement | null>(null);

  const blockers = $derived(
    (task.blockedBy ?? [])
      .map((id) => app.state.tasks.find((t) => t.id === id))
      .filter((t): t is Task => t !== undefined && !t.deleted),
  );

  const MAX_SUGGESTIONS = 6;

  const suggestions = $derived.by(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const already = new Set(task.blockedBy ?? []);
    return app.state.tasks
      .filter(
        (t) =>
          !t.deleted &&
          t.completedAt === undefined &&
          t.id !== task.id &&
          !already.has(t.id) &&
          (t.name || 'untitled').toLowerCase().includes(q) &&
          !wouldCycle(task.id, t.id, app.state.tasks),
      )
      .slice(0, MAX_SUGGESTIONS);
  });

  const listName = (id: string) => app.state.lists.find((l) => l.id === id)?.title ?? '';

  async function add(blocker: Task) {
    const next = [...(task.blockedBy ?? []), blocker.id];
    query = '';
    await app.patchTask(task.id, { blockedBy: next });
    input?.focus();
  }

  async function remove(id: string) {
    const next = (task.blockedBy ?? []).filter((b) => b !== id);
    await app.patchTask(task.id, { blockedBy: next.length > 0 ? next : undefined });
  }
</script>

<div class="blocked" data-testid="blocked-by">
  <button class="head" data-testid="blocked-by-toggle" onclick={() => (open = !open)}>
    <span class="label"><Glyph name="blocked" size={11} /> blocked by</span>
    {#if blockers.length > 0}
      <span class="tally" data-testid="blocked-by-count">{blockers.length}</span>
    {:else}
      <span class="hint">nothing</span>
    {/if}
  </button>

  {#if blockers.length > 0}
    <ul class="chips">
      {#each blockers as b (b.id)}
        <li class:done={b.completedAt !== undefined} data-testid="blocker-{b.id}">
          <span class="tick">{b.completedAt !== undefined ? '✓' : '○'}</span>
          <span class="name">{b.name || 'untitled'}</span>
          <button class="x" data-testid="blocker-remove-{b.id}"
            aria-label="remove blocker" onclick={() => void remove(b.id)}>✕</button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if open}
    <div class="picker">
      <input bind:this={input} bind:value={query} data-testid="blocked-by-input"
        placeholder="type a task name…" autocomplete="off" />
      {#if query.trim() && suggestions.length === 0}
        <p class="empty">no open tasks match (finished ones and loops are hidden)</p>
      {/if}
      {#each suggestions as s (s.id)}
        <button class="suggestion" data-testid="blocked-by-pick-{s.id}" onclick={() => void add(s)}>
          <span class="s-name">{s.name || 'untitled'}</span>
          <span class="s-list">{listName(s.listId)}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>

<style>
  .blocked { display: flex; flex-direction: column; gap: 6px; }
  .head {
    display: flex; align-items: center; gap: 8px;
    background: none; border: 1px solid var(--line); border-radius: 8px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 7px 10px; cursor: pointer; text-align: left;
  }
  @media (hover: hover) { .head:hover { border-color: var(--acc-magenta); color: var(--acc-magenta); } }
  .label { flex: 1; display: inline-flex; align-items: center; gap: 6px; }
  .tally {
    background: var(--acc-magenta); border-radius: 999px; color: var(--bg0);
    font-size: 0.62rem; font-weight: 700; padding: 1px 7px;
  }
  .hint { color: var(--line); }
  .chips { display: flex; flex-wrap: wrap; gap: 5px; list-style: none; margin: 0; padding: 0; }
  .chips li {
    display: flex; align-items: center; gap: 6px;
    background: var(--bg2); border: 1px solid var(--line); border-radius: 999px;
    font-family: var(--font-mono); font-size: 0.68rem; padding: 3px 4px 3px 9px;
    max-width: 100%;
  }
  .chips li.done { opacity: 0.5; }
  .chips li.done .name { text-decoration: line-through; }
  .tick { color: var(--acc-green); }
  .chips li:not(.done) .tick { color: var(--acc-magenta); }
  .name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 40vw; }
  .x {
    background: none; border: none; color: var(--dim);
    cursor: pointer; font-size: 0.7rem; padding: 0 4px;
  }
  @media (hover: hover) { .x:hover { color: var(--acc-magenta); } }
  .picker { display: flex; flex-direction: column; gap: 4px; }
  .picker input {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.76rem; padding: 7px 9px;
  }
  .picker input:focus { outline: none; border-color: var(--acc-magenta); }
  .suggestion {
    display: flex; align-items: baseline; gap: 8px;
    background: var(--bg1); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 6px 9px; cursor: pointer; text-align: left;
  }
  @media (hover: hover) { .suggestion:hover { border-color: var(--acc-magenta); } }
  .s-name { flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .s-list { color: var(--dim); font-size: 0.62rem; }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.66rem; margin: 2px 0 0; }
</style>
