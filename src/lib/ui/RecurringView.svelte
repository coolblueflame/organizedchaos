<!--
  Recurring templates management (spec §6): cadence + next-spawn info,
  pause/resume, edit (inline RecurrenceEditor), delete with undo.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { toast } from './toast.svelte';
  import { describeRecurrence } from './recurrenceText';
  import type { RecurrenceMode, RecurrenceTemplate } from '../domain/types';
  import RecurrenceEditor from './RecurrenceEditor.svelte';
  import Glyph from './Glyph.svelte';

  let editingId = $state<string | null>(null);

  const templates = $derived(app.state.templates.filter((t) => !t.deleted));

  function nextInfo(tpl: RecurrenceTemplate): string {
    if (tpl.paused) return 'paused';
    if (tpl.nextSpawnAt === undefined) {
      return tpl.mode.kind === 'afterCompletion' ? 'after next completion' : 'not scheduled';
    }
    const d = new Date(tpl.nextSpawnAt);
    return `next: ${d.getMonth() + 1}/${d.getDate()}`;
  }

  async function saveEdit(tpl: RecurrenceTemplate, mode: RecurrenceMode, offset?: number) {
    await app.updateRecurring(tpl.id, { mode, deadlineOffsetDays: offset });
    editingId = null;
  }

  async function remove(tpl: RecurrenceTemplate) {
    if (!window.confirm(`Stop repeating "${tpl.name}"? Existing tasks are untouched.`)) return;
    const snapshot = $state.snapshot(tpl) as RecurrenceTemplate; // plain copy for the undo closure
    await app.removeRecurring(tpl.id);
    toast.show('Recurring task removed', () => {
      void app.updateRecurring(snapshot.id, { deleted: false }).then(() => {
        app.state.templates.push({ ...snapshot, deleted: false });
      });
    });
  }
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>Recurring</h1>
  </header>

  <section class="rows">
    {#each templates as tpl (tpl.id)}
      <div class="row" data-testid="recurring-row-{tpl.id}">
        <div class="line">
          <!-- The row itself opens the editor, same as the pencil: tapping the
               thing you want to change is the obvious gesture, and the pencil is
               a small target on a phone. -->
          <button class="info" data-testid="recurring-open-{tpl.id}"
            aria-expanded={editingId === tpl.id}
            onclick={() => (editingId = editingId === tpl.id ? null : tpl.id)}>
            <span class="name" class:dim={tpl.paused}>{tpl.name || 'untitled'}</span>
            <span class="cadence">↻ {describeRecurrence(tpl.mode, tpl.deadlineOffsetDays)} · {nextInfo(tpl)}</span>
          </button>
          <div class="btns">
            <button data-testid="recurring-pause-{tpl.id}"
              onclick={() => void app.updateRecurring(tpl.id, { paused: !tpl.paused })}>
              <Glyph name={tpl.paused ? 'play' : 'pause'} size={11}
                title={tpl.paused ? 'resume' : 'pause'} />
            </button>
            <button data-testid="recurring-edit-{tpl.id}"
              onclick={() => (editingId = editingId === tpl.id ? null : tpl.id)}>✎</button>
            <button class="danger" data-testid="recurring-delete-{tpl.id}"
              onclick={() => remove(tpl)}>✕</button>
          </div>
        </div>
        {#if editingId === tpl.id}
          <RecurrenceEditor
            initial={{ mode: tpl.mode, deadlineOffsetDays: tpl.deadlineOffsetDays }}
            onsave={(mode, offset) => void saveEdit(tpl, mode, offset)}
            oncancel={() => (editingId = null)} />
        {/if}
      </div>
    {/each}
    {#if templates.length === 0}
      <p class="empty">// no recurring tasks yet — set one up from any task's editor</p>
    {/if}
  </section>
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .rows { display: flex; flex-direction: column; gap: 6px; }
  .row { background: var(--bg1); border: 1px solid var(--line); border-radius: 8px; padding: 10px 12px; }
  .line { display: flex; align-items: center; gap: 8px; }
  .info {
    flex: 1; display: flex; flex-direction: column; gap: 3px; min-width: 0;
    background: none; border: none; padding: 2px 0; text-align: left;
    color: inherit; font: inherit; cursor: pointer;
  }
  .info:hover .name { color: var(--acc-cyan); }
  .name { font-size: 0.9rem; font-weight: 500; }
  .name.dim { color: var(--dim); }
  .cadence { color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.7rem; }
  .btns { display: flex; gap: 4px; }
  .btns button {
    display: inline-flex; align-items: center; justify-content: center;
    background: none; border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-size: 0.8rem; padding: 5px 8px; cursor: pointer;
  }
  .btns button:hover { color: var(--text); }
  .btns .danger:hover { color: var(--acc-magenta); border-color: var(--acc-magenta); }
  .empty { color: var(--dim); font-family: var(--font-mono); font-size: 0.85rem; }
</style>
