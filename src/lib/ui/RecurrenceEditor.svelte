<!--
  Pure cadence form (no store access) shared by TaskEditor and RecurringView.
  Modes: after-completion (interval+unit), weekly (weekday chips), monthly (day).
  Optional "deadline lands N days after spawn".
-->
<script lang="ts">
  import { untrack } from 'svelte';
  import type { RecurrenceMode } from '../domain/types';

  let {
    initial, onsave, oncancel, onremove,
  }: {
    initial?: { mode: RecurrenceMode; deadlineOffsetDays?: number };
    onsave: (mode: RecurrenceMode, deadlineOffsetDays?: number) => void;
    oncancel: () => void;
    onremove?: () => void;
  } = $props();

  type Kind = RecurrenceMode['kind'];
  // Intentional one-time seed from props (untrack silences the reactivity
  // warning): the parent remounts this component per open, so `initial` can
  // never swap underneath a live form.
  const seed = untrack(() => initial);
  const init = seed?.mode;

  let kind = $state<Kind>(init?.kind ?? 'afterCompletion');
  let interval = $state(init?.kind === 'afterCompletion' ? init.interval : 3);
  let unit = $state<'days' | 'weeks' | 'months'>(init?.kind === 'afterCompletion' ? init.unit : 'days');
  let weekdays = $state<number[]>(init?.kind === 'weekly' ? [...init.weekdays] : []);
  let monthday = $state(init?.kind === 'monthly' ? init.dayOfMonth : 1);
  let offset = $state<string>(seed?.deadlineOffsetDays?.toString() ?? '');

  // Mon-first display order; values are JS getDay numbers.
  const WEEKDAYS: Array<[number, string]> =
    [[1, 'mo'], [2, 'tu'], [3, 'we'], [4, 'th'], [5, 'fr'], [6, 'sa'], [0, 'su']];

  function toggleWeekday(d: number) {
    weekdays = weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d];
  }

  const valid = $derived(
    kind === 'afterCompletion' ? interval >= 1 :
    kind === 'weekly' ? weekdays.length > 0 :
    monthday >= 1 && monthday <= 31,
  );

  function save() {
    if (!valid) return;
    const mode: RecurrenceMode =
      kind === 'afterCompletion' ? { kind, interval, unit } :
      kind === 'weekly' ? { kind, weekdays: [...weekdays].sort() } :
      { kind, dayOfMonth: monthday };
    const off = parseInt(offset, 10);
    // 0 is a real answer — "due the day it appears" — only blank/negative mean unset.
    onsave(mode, Number.isFinite(off) && off >= 0 ? off : undefined);
  }
</script>

<div class="recur">
  <div class="modes">
    <button class:active={kind === 'afterCompletion'} data-testid="recur-mode-afterCompletion"
      onclick={() => (kind = 'afterCompletion')}>after completion</button>
    <button class:active={kind === 'weekly'} data-testid="recur-mode-weekly"
      onclick={() => (kind = 'weekly')}>weekly</button>
    <button class:active={kind === 'monthly'} data-testid="recur-mode-monthly"
      onclick={() => (kind = 'monthly')}>monthly</button>
  </div>

  {#if kind === 'afterCompletion'}
    <div class="line">
      <span>comes back</span>
      <input type="number" min="1" data-testid="recur-interval" bind:value={interval} />
      <select data-testid="recur-unit" bind:value={unit}>
        <option value="days">days</option>
        <option value="weeks">weeks</option>
        <option value="months">months</option>
      </select>
      <span>after done</span>
    </div>
  {:else if kind === 'weekly'}
    <div class="weekdays">
      {#each WEEKDAYS as [d, label] (d)}
        <button class="day" class:on={weekdays.includes(d)}
          data-testid="recur-weekday-{d}" onclick={() => toggleWeekday(d)}>{label}</button>
      {/each}
    </div>
  {:else}
    <div class="line">
      <span>on day</span>
      <input type="number" min="1" max="31" data-testid="recur-monthday" bind:value={monthday} />
      <span>of each month <em>(clamped in short months)</em></span>
    </div>
  {/if}

  <div class="line">
    <span>deadline</span>
    <input type="number" min="0" placeholder="—" data-testid="recur-deadline-offset" bind:value={offset} />
    <span>days after it appears <em>(optional; 0 = due that day)</em></span>
  </div>

  <div class="actions">
    {#if onremove}
      <button class="danger" data-testid="recur-remove" onclick={onremove}>stop repeating</button>
    {/if}
    <span class="spacer"></span>
    <button onclick={oncancel}>cancel</button>
    <button class="save" data-testid="recur-save" disabled={!valid} onclick={save}>save</button>
  </div>
</div>

<style>
  .recur {
    display: flex; flex-direction: column; gap: 10px;
    border: 1px solid var(--line); border-radius: 8px; padding: 12px;
    background: var(--bg2);
  }
  .modes { display: flex; gap: 6px; }
  .modes button {
    flex: 1; background: var(--bg1); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 7px 4px; cursor: pointer;
  }
  .modes button.active { color: var(--acc-cyan); border-color: var(--acc-cyan); }
  .line {
    display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem;
  }
  .line em { font-style: normal; opacity: 0.6; }
  .line input, .line select {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.8rem;
    padding: 5px 6px; width: 64px;
  }
  .line select { width: auto; }
  .weekdays { display: flex; gap: 5px; }
  .day {
    flex: 1; background: var(--bg1); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    padding: 7px 0; cursor: pointer; text-transform: uppercase;
  }
  .day.on { color: var(--acc-green); border-color: var(--acc-green); }
  .actions { display: flex; align-items: center; gap: 8px; }
  .spacer { flex: 1; }
  .actions button {
    background: none; border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem;
    padding: 6px 12px; cursor: pointer;
  }
  .actions .save { color: var(--acc-green); border-color: var(--acc-green); }
  .actions .save:disabled { opacity: 0.4; cursor: default; }
  .actions .danger { color: var(--acc-magenta); }
</style>
