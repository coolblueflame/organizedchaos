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
  /** 1 = plain weekly; 2+ = every Nth week (2026-08-06 ask). */
  let everyWeeks = $state(init?.kind === 'weekly' ? (init.everyWeeks ?? 1) : 1);
  /**
   * The saved phase — WHICH weeks are on. It must survive a reopen-save
   * untouched (review catch: stamping Date.now() on every save meant an
   * off-week tweak of the deadline offset silently shifted every future
   * spawn, and a Saturday edit of a biweekly-Monday rule deferred it
   * forever). A fresh anchor is minted only when the cadence itself changes.
   */
  const initialAnchor = init?.kind === 'weekly' ? init.anchorMs : undefined;
  const initialEvery = init?.kind === 'weekly' ? (init.everyWeeks ?? 1) : 1;
  /** True when saving will start counting weeks from now (new/changed cadence). */
  const willReAnchor = $derived(
    everyWeeks > 1 && (initialAnchor === undefined || everyWeeks !== initialEvery),
  );
  let monthday = $state<number | ''>(init?.kind === 'monthly' && !init.days?.length ? init.dayOfMonth : '');
  /** Extra month days beyond the input — chips; 'last' is the true month end. */
  let monthdays = $state<Array<number | 'last'>>(
    init?.kind === 'monthly' && init.days?.length ? [...init.days] : [],
  );
  let offset = $state<string>(seed?.deadlineOffsetDays?.toString() ?? '');

  // Sunday-first display order, like every other day picker; values are JS
  // getDay numbers, so storage is untouched.
  const WEEKDAYS: Array<[number, string]> =
    [[0, 'su'], [1, 'mo'], [2, 'tu'], [3, 'we'], [4, 'th'], [5, 'fr'], [6, 'sa']];

  function toggleWeekday(d: number) {
    weekdays = weekdays.includes(d) ? weekdays.filter((x) => x !== d) : [...weekdays, d];
  }

  /** The input counts as a day the moment it holds a valid number — no
   *  "+ add" needed for the everyday single-date case. */
  const pendingDay = $derived(
    typeof monthday === 'number' && monthday >= 1 && monthday <= 31 ? monthday : null,
  );
  /** Everything the monthly save would commit, deduped, numerics first. */
  const allMonthdays = $derived.by(() => {
    const nums = new Set(monthdays.filter((d): d is number => d !== 'last'));
    if (pendingDay !== null) nums.add(pendingDay);
    const out: Array<number | 'last'> = [...nums].sort((a, b) => a - b);
    if (monthdays.includes('last')) out.push('last');
    return out;
  });

  function addMonthday() {
    if (pendingDay === null) return;
    if (!monthdays.includes(pendingDay)) monthdays = [...monthdays, pendingDay];
    monthday = '';
  }

  function dropMonthday(d: number | 'last') {
    monthdays = monthdays.filter((x) => x !== d);
  }

  function toggleLastDay() {
    monthdays = monthdays.includes('last')
      ? monthdays.filter((x) => x !== 'last')
      : [...monthdays, 'last'];
  }

  const valid = $derived(
    kind === 'afterCompletion' ? interval >= 1 :
    kind === 'weekly' ? weekdays.length > 0 :
    allMonthdays.length > 0,
  );

  function save() {
    if (!valid) return;
    const mode: RecurrenceMode =
      kind === 'afterCompletion' ? { kind, interval, unit } :
      kind === 'weekly' ? {
        kind,
        weekdays: [...weekdays].sort(),
        // Written only when they carry information: a plain weekly template
        // keeps its exact old shape (canonical-stable in sync, readable by
        // old code). The anchor pins WHICH weeks are on — kept across saves,
        // minted fresh only when the cadence itself is new or changed.
        ...(everyWeeks > 1
          ? { everyWeeks, anchorMs: willReAnchor ? Date.now() : initialAnchor! }
          : {}),
      } :
      {
        kind: 'monthly' as const,
        // Old readers only see dayOfMonth: the first numeric day, or 31 when
        // it is only "last" (31 clamps to the month end — close enough).
        dayOfMonth: allMonthdays.find((d): d is number => d !== 'last') ?? 31,
        ...(allMonthdays.length > 1 || allMonthdays.includes('last')
          ? { days: allMonthdays }
          : {}),
      };
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
    <div class="line">
      <span>repeats</span>
      <select data-testid="recur-every-weeks" bind:value={everyWeeks}>
        <option value={1}>every week</option>
        <option value={2}>every 2 weeks</option>
        <option value={3}>every 3 weeks</option>
        <option value={4}>every 4 weeks</option>
      </select>
      <!-- Only when saving really restarts the count — an untouched reopen
           keeps its phase and must not claim otherwise. -->
      {#if willReAnchor}<em>counting from this week</em>{/if}
    </div>
  {:else}
    <div class="line">
      <span>on day</span>
      <input type="number" min="1" max="31" data-testid="recur-monthday" bind:value={monthday} />
      <button class="add" data-testid="recur-monthday-add" disabled={pendingDay === null}
        onclick={addMonthday}>+ another</button>
      <button class="day last" class:on={monthdays.includes('last')}
        data-testid="recur-last-day" onclick={toggleLastDay}>last day</button>
    </div>
    {#if monthdays.filter((d) => d !== 'last').length > 0}
      <div class="line chips" data-testid="recur-monthday-chips">
        {#each monthdays.filter((d) => d !== 'last') as d (d)}
          <button class="chip" data-testid="recur-monthday-drop-{d}" onclick={() => dropMonthday(d)}
            title="remove">{d} ✕</button>
        {/each}
      </div>
    {/if}
    <div class="line"><em>(days past a short month clamp to its end)</em></div>
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
  .day.last { flex: none; padding: 7px 10px; text-transform: none; }
  .add {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem;
    padding: 6px 8px; cursor: pointer;
  }
  .add:disabled { opacity: 0.4; cursor: default; }
  .chips { gap: 5px; }
  .chip {
    background: var(--bg1); border: 1px solid var(--acc-green); border-radius: 6px;
    color: var(--acc-green); font-family: var(--font-mono); font-size: 0.7rem;
    padding: 5px 8px; cursor: pointer;
  }
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
