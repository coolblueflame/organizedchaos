<!--
  The ritual-times form: one or more daily windows, each with its days, and
  for several windows whether each counts separately. Shared by the task
  editor (one task) and the bulk bars (every selected task gets the same
  schedule). It only edits a draft; the caller decides what saving means.
-->
<script lang="ts">
  import { ALL_DAYS, type HoursRule } from '../domain/schedule';

  let { initial, perWindow = false, onsave, oncancel, onremove, note }: {
    /** The windows to start from; empty = one fresh window around now. */
    initial: HoursRule[];
    /** Whether the starting schedule counts each window separately. */
    perWindow?: boolean;
    /**
     * Called with the cleaned windows (at least one) and the per-window flag.
     * A form with no usable window calls oncancel instead.
     */
    onsave: (windows: HoursRule[], perWindow: boolean) => void;
    oncancel: () => void;
    /** Shown as a "remove" button when present. */
    onremove?: () => void;
    /** Overrides the explanatory line under the form. */
    note?: string;
  } = $props();

  const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

  /** `toTouched`: the user set the end themselves, so it stops following the start. */
  type DraftWindow = { from: string; to: string; days: number[]; toTouched?: boolean };

  // Seeded once from the props at mount: editing the fields must not be fought
  // by the value they came from.
  // svelte-ignore state_referenced_locally
  let wins = $state<DraftWindow[]>(initial.length > 0
    // Saved windows are the user's: never auto-adjust their ends.
    ? initial.map((w) => ({ from: w.from, to: w.to, days: [...w.days], toTouched: true }))
    : [{ from: nearestHour(), to: nearestHour(1), days: [...ALL_DAYS] }]);
  // svelte-ignore state_referenced_locally
  let each = $state(perWindow);

  /** "HH:MM" for the hour nearest to now, +offsetH, never with minutes to drag off. */
  function nearestHour(offsetH = 0): string {
    const d = new Date();
    const h = (d.getHours() + (d.getMinutes() >= 30 ? 1 : 0) + offsetH) % 24;
    return `${String(h).padStart(2, '0')}:00`;
  }

  /** from + 1h, wrapping midnight; '' passes through untouched. */
  function hourAfter(from: string): string {
    const m = from.match(/^(\d{2}):(\d{2})$/);
    if (!m) return '';
    return `${String((Number(m[1]) + 1) % 24).padStart(2, '0')}:${m[2]}`;
  }

  function addWindow() {
    // A fresh window borrows the last one's days: "drink water" repeats the
    // same day pattern far more often than it varies it. Times seed to the
    // nearest whole hour, one hour long: an empty time input opens the picker
    // at the CURRENT minute, and dragging minutes back to ":00" got old fast.
    const prev = wins[wins.length - 1];
    const from = nearestHour();
    wins = [...wins, { from, to: hourAfter(from), days: prev ? [...prev.days] : [...ALL_DAYS] }];
  }

  /** Picking a start re-seeds the end an hour later, until the user has
      deliberately set an end of their own, which then stays theirs. */
  function fromChanged(i: number) {
    const win = wins[i];
    if (win && !win.toTouched) win.to = hourAfter(win.from);
  }

  function dropWindow(i: number) {
    wins = wins.filter((_, x) => x !== i);
  }

  function toggleDay(i: number, d: number) {
    wins = wins.map((w, x) => x === i
      ? { ...w, days: w.days.includes(d) ? w.days.filter((y) => y !== d) : [...w.days, d] }
      : w);
  }

  function save() {
    const valid = wins
      .filter((w) => w.days.length > 0 && w.from && w.to && w.from !== w.to)
      .map((w) => ({ days: [...w.days].sort((a, b) => a - b), from: w.from, to: w.to }));
    if (valid.length === 0) { oncancel(); return; }
    onsave(valid, valid.length > 1 && each);
  }
</script>

<div class="ritual-editor">
  {#each wins as win, i (i)}
    <div class="ritual-window">
      <div class="ritual-row" class:has-drop={wins.length > 1}>
        <label><span>from</span>
          <input type="time" data-testid={i === 0 ? 'ritual-from' : `ritual-from-${i}`}
            bind:value={win.from} onchange={() => fromChanged(i)} /></label>
        <label><span>until</span>
          <input type="time" data-testid={i === 0 ? 'ritual-to' : `ritual-to-${i}`}
            bind:value={win.to} onchange={() => (win.toTouched = true)} /></label>
        {#if wins.length > 1}
          <button class="win-drop" data-testid="ritual-window-drop-{i}"
            aria-label="remove this time" onclick={() => dropWindow(i)}>✕</button>
        {/if}
      </div>
      <div class="days">
        {#each DAY_LABELS as label, d (d)}
          <button class="day" class:on={win.days.includes(d)}
            data-testid={i === 0 ? `ritual-day-${d}` : `ritual-day-${i}-${d}`}
            onclick={() => toggleDay(i, d)}>{label}</button>
        {/each}
      </div>
    </div>
  {/each}
  <button class="win-add" data-testid="ritual-add-window" onclick={addWindow}>
    + another time
  </button>
  {#if wins.length > 1}
    <label class="each" data-testid="ritual-each-row">
      <input type="checkbox" data-testid="ritual-each" bind:checked={each} />
      each time counts separately
      <span class="each-hint">{each
        ? '- it comes up again at every window (drink water)'
        : '- any one window does the whole day (walk the dogs)'}</span>
    </label>
  {/if}
  <p class="ritual-note">
    {note ?? 'Inside a window it jumps ahead of everything but MAX-priority work until it’s done. Miss a day and nothing piles up - it just comes round again tomorrow.'}
  </p>
  <div class="ritual-actions">
    <button data-testid="ritual-save" onclick={save}>save</button>
    <button data-testid="ritual-cancel" onclick={oncancel}>cancel</button>
    {#if onremove}
      <button class="drop" data-testid="ritual-remove" onclick={onremove}>remove</button>
    {/if}
  </div>
</div>

<style>
  .ritual-editor {
    display: flex; flex-direction: column; gap: 8px;
    border: 1px solid var(--acc-cyan); border-radius: 6px; padding: 10px;
  }
  .ritual-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; align-items: end; }
  /* The ✕ column exists only when a window can be removed: even an EMPTY auto
     track costs its grid gap, which was the 6px that overflowed a 320px phone. */
  .ritual-row.has-drop { grid-template-columns: 1fr 1fr auto; }
  .ritual-row label { display: flex; flex-direction: column; gap: 4px; }
  .ritual-row span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .ritual-row input {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 7px 8px; font-size: 0.85rem; outline: none;
    color-scheme: dark; width: 100%;
  }
  .days { display: flex; gap: 4px; }
  .day {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; padding: 6px 0; cursor: pointer;
  }
  .day.on { color: var(--acc-green); border-color: var(--acc-green); }
  .ritual-note { color: var(--dim); font-size: 0.72rem; line-height: 1.5; margin: 0; }
  .ritual-window { display: flex; flex-direction: column; gap: 8px; }
  .ritual-window + .ritual-window { border-top: 1px dashed var(--line); padding-top: 10px; }
  .win-drop {
    align-self: flex-end; background: none; border: none; color: var(--dim);
    cursor: pointer; font-size: 0.8rem; padding: 4px 6px;
  }
  @media (hover: hover) { .win-drop:hover { color: var(--acc-magenta); } }
  .win-add {
    align-self: flex-start; background: none; border: 1px dashed var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 5px 10px; cursor: pointer;
  }
  @media (hover: hover) { .win-add:hover { color: var(--acc-cyan); border-color: var(--acc-cyan); } }
  .each {
    display: flex; align-items: baseline; gap: 7px; flex-wrap: wrap;
    color: var(--text); font-size: 0.78rem; cursor: pointer;
  }
  .each input { accent-color: var(--acc-cyan); }
  .each-hint { color: var(--dim); font-size: 0.72rem; }
  .ritual-actions { display: flex; gap: 8px; }
  .ritual-actions button {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.75rem;
    padding: 5px 12px; cursor: pointer;
  }
  .ritual-actions .drop { color: var(--acc-magenta); margin-left: auto; }
</style>
