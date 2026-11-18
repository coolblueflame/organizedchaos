<!--
  The schedule half of a bulk bar (2026-11-18 ask): "ritual times" and
  "repeat" give every selected task the same schedule, using the same forms
  as the task editor. A plain task in the selection is converted: it becomes
  a ritual, or starts repeating. Laid out with `display: contents`, so its
  cells join the parent bar's two-column grid.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { isRitualTask, ritualWindows } from '../domain/ritual';
  import type { HoursRule } from '../domain/schedule';
  import type { RecurrenceMode } from '../domain/types';
  import RitualEditor from './RitualEditor.svelte';
  import RecurrenceEditor from './RecurrenceEditor.svelte';

  let { ids, repeat = true, onopen }: {
    /** The selected task ids. */
    ids: string[];
    /** Offer "repeat" as well as "ritual times". */
    repeat?: boolean;
    /** Told whenever a form opens or closes, so the bar can make room for it. */
    onopen?: (open: boolean) => void;
  } = $props();

  let open = $state<'ritual' | 'repeat' | null>(null);
  $effect(() => { onopen?.(open !== null); });

  const selectedTasks = $derived(
    ids.map((id) => app.state.tasks.find((t) => t.id === id)).filter((t) => t !== undefined),
  );
  /** The form starts from the first selected task that already has a schedule. */
  const seedRitual = $derived(selectedTasks.find((t) => isRitualTask(t)));
  const seedTemplate = $derived.by(() => {
    for (const t of selectedTasks) {
      const tpl = t.recurrenceId
        ? app.state.templates.find((x) => x.id === t.recurrenceId && !x.deleted)
        : undefined;
      if (tpl) return tpl;
    }
    return undefined;
  });

  async function saveRitual(windows: HoursRule[], perWindow: boolean) {
    open = null;
    await app.bulkSetRitual(ids, windows, perWindow);
  }

  async function saveRepeat(mode: RecurrenceMode, deadlineOffsetDays?: number) {
    open = null;
    await app.bulkSetRecurrence(ids, mode, deadlineOffsetDays);
  }

  const n = $derived(ids.length);
</script>

<div class="cells">
  <button class:wide={!repeat} class:on={open === 'ritual'} data-testid="bulk-ritual"
    onclick={() => (open = open === 'ritual' ? null : 'ritual')}>⧗ ritual times…</button>
  {#if repeat}
    <button class:on={open === 'repeat'} data-testid="bulk-repeat"
      onclick={() => (open = open === 'repeat' ? null : 'repeat')}>↻ repeat…</button>
  {/if}
  {#if open === 'ritual'}
    <div class="panel" data-testid="bulk-ritual-panel">
      <RitualEditor
        initial={seedRitual ? ritualWindows(seedRitual) : []}
        perWindow={seedRitual?.ritualPerWindow === true}
        note={`Every selected task gets exactly these times (${n} task${n === 1 ? '' : 's'}). Tasks that aren't rituals yet become rituals.`}
        onsave={(w, each) => void saveRitual(w, each)}
        oncancel={() => (open = null)} />
    </div>
  {:else if open === 'repeat'}
    <div class="panel" data-testid="bulk-repeat-panel">
      <p class="hint">Every selected task repeats like this ({n} task{n === 1 ? '' : 's'}). Tasks that don't repeat yet start repeating.</p>
      <RecurrenceEditor
        initial={seedTemplate ? { mode: seedTemplate.mode, deadlineOffsetDays: seedTemplate.deadlineOffsetDays } : undefined}
        onsave={(mode, offset) => void saveRepeat(mode, offset)}
        oncancel={() => (open = null)} />
    </div>
  {/if}
</div>

<style>
  /* The cells sit in the parent bar's grid as if they were its own. */
  .cells { display: contents; }
  /* Same metrics as the bar's own controls (they cannot reach in here). */
  button {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 4px 9px; margin: 0; line-height: 1.3; cursor: pointer;
    width: 100%; min-width: 0; min-height: 30px; box-sizing: border-box;
  }
  button.on { border-color: var(--acc-cyan); color: var(--acc-cyan); }
  .wide, .panel { grid-column: 1 / -1; }
  /* The bar is pinned to the bottom of the screen; a tall form scrolls inside
     it rather than running off the top. The height left above the bar's own
     controls goes to the form (a list's bar hides its other controls while
     a form is open); svh, not vh, so the browser's toolbars are already
     accounted for. */
  .panel { max-height: max(240px, calc(100svh - 160px)); overflow-y: auto; }
  .hint { color: var(--dim); font-size: 0.72rem; line-height: 1.5; margin: 0 0 6px; }
</style>
