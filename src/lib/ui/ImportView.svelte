<!--
  "Import from Things" (spec §9): pick main.sqlite → parse in-browser (sql.js,
  lazy WASM) → preview the mapping → import (idempotent) → review any decoded
  recurrences. Generic by design — works for anyone's Things database.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { readThingsDb } from '../import/thingsRead';
  import { mapThings, type MappedImport } from '../import/thingsMap';
  import { describeRecurrence } from './recurrenceText';
  import type { RecurrenceMode } from '../domain/types';
  import RecurrenceEditor from './RecurrenceEditor.svelte';

  type Step = 'pick' | 'parsing' | 'preview' | 'importing' | 'review' | 'done';
  let step = $state<Step>('pick');
  let error = $state('');
  let mapped = $state<MappedImport | null>(null);
  let editingUuid = $state<string | null>(null);

  async function onFile(e: Event) {
    const file = (e.currentTarget as HTMLInputElement).files?.[0];
    if (!file) return;
    step = 'parsing';
    error = '';
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      mapped = mapThings(await readThingsDb(bytes));
      step = 'preview';
    } catch (err) {
      error = `Could not read that file as a Things database — ${err instanceof Error ? err.message : err}`;
      step = 'pick';
    }
  }

  async function runImport() {
    if (!mapped) return;
    step = 'importing';
    try {
      await app.importThings(mapped);
      step = mapped.review.length > 0 ? 'review' : 'done';
    } catch (err) {
      error = `Import failed: ${err instanceof Error ? err.message : err}`;
      step = 'preview';
    }
  }

  /** After import, review items refer to templates by thingsUuid. */
  const templateFor = (thingsUuid: string) =>
    app.state.templates.find((t) => t.thingsUuid === thingsUuid);

  async function saveReviewEdit(thingsUuid: string, mode: RecurrenceMode, offset?: number) {
    const tpl = templateFor(thingsUuid);
    if (tpl) await app.updateRecurring(tpl.id, { mode, deadlineOffsetDays: offset });
    editingUuid = null;
  }
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'settings' })}>‹</button>
    <h1>Import from Things</h1>
  </header>

  {#if step === 'pick'}
    <section class="panel">
      <p class="hint">
        Pick your Things database file (<code>main.sqlite</code>). Everything is parsed right
        here on your device — nothing is uploaded anywhere. Re-importing later is safe: existing
        items are matched, never duplicated, and your local edits win.
      </p>
      <input type="file" data-testid="import-file" onchange={onFile} />
      {#if error}<p class="error">{error}</p>{/if}
    </section>
  {:else if step === 'parsing' || step === 'importing'}
    <section class="panel">
      <p class="hint">{step === 'parsing' ? '// reading database…' : '// importing…'}</p>
    </section>
  {:else if step === 'preview' && mapped}
    <section class="panel" data-testid="import-preview">
      <h2>found in your database</h2>
      <ul class="counts">
        <li><b>{mapped.counts.lists}</b> lists (projects + areas)</li>
        <li><b>{mapped.counts.openTasks}</b> open tasks</li>
        <li><b>{mapped.counts.completedTasks}</b> completed tasks (your history — powers the stats)</li>
        <li><b>{mapped.counts.tags}</b> tags (Things tags + headings)</li>
        <li><b>{mapped.counts.templates}</b> recurring tasks{#if mapped.review.length}&nbsp;(will ask you to double-check them){/if}</li>
      </ul>
      {#if error}<p class="error">{error}</p>{/if}
      <button class="primary" data-testid="import-run" onclick={runImport}>import everything</button>
    </section>
  {:else if step === 'review' && mapped}
    <section class="panel" data-testid="import-review">
      <h2>double-check your recurring tasks</h2>
      <p class="hint">Things stores repeat rules in a private format — these were decoded
        best-effort. Tap any to adjust.</p>
      {#each mapped.review as r (r.templateThingsUuid)}
        {@const tpl = templateFor(r.templateThingsUuid)}
        <div class="review-row">
          <button class="review-msg" onclick={() => (editingUuid = editingUuid === r.templateThingsUuid ? null : r.templateThingsUuid)}>
            {#if tpl}↻ "{tpl.name}" — {describeRecurrence(tpl.mode, tpl.deadlineOffsetDays)}{:else}{r.message}{/if}
          </button>
          {#if editingUuid === r.templateThingsUuid && tpl}
            <RecurrenceEditor
              initial={{ mode: tpl.mode, deadlineOffsetDays: tpl.deadlineOffsetDays }}
              onsave={(mode, offset) => void saveReviewEdit(r.templateThingsUuid, mode, offset)}
              oncancel={() => (editingUuid = null)} />
          {/if}
        </div>
      {/each}
      <button class="primary" data-testid="import-review-done" onclick={() => (step = 'done')}>looks good</button>
    </section>
  {:else}
    <section class="panel" data-testid="import-done">
      <h2>imported ✓</h2>
      <p class="hint">Welcome to organized chaos. The big button awaits.</p>
      <button class="primary" onclick={() => navigate({ name: 'home' })}>go home</button>
    </section>
  {/if}
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .panel {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px;
    padding: 16px; display: flex; flex-direction: column; gap: 12px;
  }
  h2 { color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.08em; margin: 0; }
  .hint { color: var(--dim); font-size: 0.85rem; margin: 0; line-height: 1.5; }
  code { font-family: var(--font-mono); color: var(--acc-green); }
  .counts { margin: 0; padding-left: 18px; color: var(--text); font-size: 0.9rem; line-height: 1.8; }
  .counts b { color: var(--acc-purple); font-family: var(--font-mono); }
  .primary {
    background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 8px;
    color: var(--acc-green); font-family: var(--font-mono); font-weight: 700;
    padding: 12px; cursor: pointer;
  }
  .error { color: var(--acc-magenta); font-size: 0.8rem; margin: 0; }
  input[type='file'] { color: var(--dim); font-size: 0.85rem; }
  .review-row { display: flex; flex-direction: column; gap: 8px; }
  .review-msg {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.78rem;
    padding: 10px; cursor: pointer; text-align: left;
  }
</style>
