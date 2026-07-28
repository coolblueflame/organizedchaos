<!--
  Everything about one list in a single dismissible sheet: name, grouping,
  project deadline, randomizer hours (weekday-aware), and deletion. Replaces
  the old inline row editors, which lost the list's name and couldn't be
  dismissed without committing.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import type { List } from '../domain/types';
  import { type HoursRule, ALL_DAYS, WEEKDAYS, WEEKEND, hoursRules } from '../domain/schedule';
  import { projectPriority, remainingEstimateHours } from '../domain/project';
  import { formatDuration } from '../domain/stats';
  import Glyph from './Glyph.svelte';

  let { list, onclose }: { list: List; onclose: () => void } = $props();

  // svelte-ignore state_referenced_locally
  let title = $state(list.title);
  // svelte-ignore state_referenced_locally
  let areaGroup = $state(list.areaGroup ?? '');
  // svelte-ignore state_referenced_locally
  let deadline = $state(list.deadline ?? '');
  // svelte-ignore state_referenced_locally
  let urgent = $state(list.urgentOverridesHours ?? false);
  // svelte-ignore state_referenced_locally
  let rules = $state<HoursRule[]>(hoursRules(list).map((r) => ({ ...r, days: [...r.days] })));
  let deleteArmed = $state(false);

  const DAYS: Array<[number, string]> =
    [[1, 'M'], [2, 'T'], [3, 'W'], [4, 'T'], [5, 'F'], [6, 'S'], [0, 'S']];

  const hoursLeft = $derived(remainingEstimateHours(app.state.tasks, list.id));
  const projectTier = $derived(
    deadline
      ? projectPriority({ ...list, deadline }, app.state.tasks, app.state.settings, new Date())
      : null,
  );

  function toggleDay(rule: HoursRule, day: number) {
    rule.days = rule.days.includes(day)
      ? rule.days.filter((d) => d !== day)
      : [...rule.days, day];
  }

  function addRule(days: number[] = ALL_DAYS) {
    rules = [...rules, { days: [...days], from: '09:00', to: '17:00' }];
  }

  function removeRule(i: number) {
    rules = rules.filter((_, idx) => idx !== i);
  }

  /** Saves everything at once so "cancel" genuinely means no changes. */
  async function save() {
    // $state.snapshot is mandatory: these rules are reactive PROXIES, and
    // IndexedDB's structured clone throws on proxies — the write would fail
    // and the sheet would silently never close.
    const clean = ($state.snapshot(rules) as HoursRule[]).filter((r) => r.days.length > 0);
    await app.updateList(list.id, {
      title: title.trim() || list.title,
      areaGroup: areaGroup.trim() || undefined,
      deadline: deadline || undefined,
      urgentOverridesHours: clean.length > 0 ? urgent : undefined,
      hours: clean.length > 0 ? clean : undefined,
      // The rules array supersedes the old single-window fields.
      activeFrom: undefined,
      activeTo: undefined,
    });
    if (deadline) app.grantUnlockAndShow('clairvoyant');
    onclose();
  }

  async function remove() {
    if (!deleteArmed) {
      deleteArmed = true;
      setTimeout(() => (deleteArmed = false), 3000);
      return;
    }
    await app.removeList(list.id);
    onclose();
  }

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onclose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>

<section class="sheet" data-testid="list-settings">
  <header>
    <input class="title" data-testid="list-settings-title" bind:value={title} />
    <button class="x" data-testid="list-settings-cancel" onclick={onclose} aria-label="close">✕</button>
  </header>

  <label class="field">
    <span>group under</span>
    <input data-testid="list-settings-group" bind:value={areaGroup} placeholder="(none)" />
  </label>

  <section class="block">
    <h3>project deadline</h3>
    <p class="hint">Finish the whole list by a date and every task in it climbs the
      priority tiers together, based on the total work left.</p>
    <label class="field">
      <span>done by</span>
      <input type="date" data-testid="list-settings-deadline" bind:value={deadline} />
    </label>
    {#if deadline}
      <p class="readout" data-testid="list-settings-readout">
        {formatDuration(hoursLeft)} of work left
        {#if projectTier}· currently pushing its tasks to <b class={projectTier}>{projectTier}</b>{/if}
      </p>
    {/if}
  </section>

  <section class="block">
    <h3>randomizer hours</h3>
    <p class="hint">When the dice may draw from this list. Leave empty for any time.</p>
    {#each rules as rule, i (i)}
      <div class="rule" data-testid="hours-rule-{i}">
        <div class="days">
          {#each DAYS as [day, letter], di (di)}
            <button class="day" class:on={rule.days.includes(day)}
              data-testid="hours-rule-{i}-day-{day}"
              onclick={() => toggleDay(rule, day)}>{letter}</button>
          {/each}
        </div>
        <div class="times">
          <input type="time" data-testid="hours-rule-{i}-from" bind:value={rule.from} />
          <span class="dash">→</span>
          <input type="time" data-testid="hours-rule-{i}-to" bind:value={rule.to} />
          <button class="drop" data-testid="hours-rule-{i}-remove" onclick={() => removeRule(i)}>✕</button>
        </div>
      </div>
    {/each}
    <div class="rule-adds">
      <button data-testid="hours-add" onclick={() => addRule()}>+ any day</button>
      <button data-testid="hours-add-weekdays" onclick={() => addRule(WEEKDAYS)}>+ weekdays</button>
      <button data-testid="hours-add-weekend" onclick={() => addRule(WEEKEND)}>+ weekends</button>
    </div>
    {#if rules.length > 0}
      <label class="opt">
        <input type="checkbox" data-testid="list-settings-urgent" bind:checked={urgent} />
        <span class="with-glyph"><Glyph name="bolt" size={11} /> let MAX-priority tasks through outside these hours</span>
      </label>
    {/if}
  </section>

  <div class="actions">
    <button class="danger" class:armed={deleteArmed} data-testid="list-settings-delete" onclick={remove}>
      {deleteArmed ? 'tap again to delete list' : 'delete list'}
    </button>
    <button class="primary" data-testid="list-settings-save" onclick={save}>save</button>
  </div>
</section>

<style>
  .with-glyph { display: inline-flex; align-items: center; gap: 6px; }

  .backdrop { position: fixed; inset: 0; background: rgba(4, 6, 10, 0.6); z-index: 190; }
  .sheet {
    position: fixed; z-index: 200; left: 50%; transform: translateX(-50%);
    top: calc(12px + env(safe-area-inset-top));
    width: min(94vw, 560px);
    max-height: calc(100vh - 24px - env(safe-area-inset-top)); overflow-y: auto;
    background: var(--bg1); border: 1px solid var(--acc-blue); border-radius: 14px;
    padding: 14px; display: flex; flex-direction: column; gap: 12px;
    box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  }
  header { display: flex; align-items: center; gap: 8px; }
  .title {
    flex: 1; background: none; border: none; border-bottom: 1px solid var(--line);
    color: var(--text); font-size: 1.15rem; font-weight: 600; padding: 4px 2px; outline: none;
  }
  .title:focus { border-bottom-color: var(--acc-blue); }
  .x { background: none; border: none; color: var(--dim); cursor: pointer; font-size: 0.9rem; padding: 2px 6px; }
  .block {
    border: 1px solid var(--line); border-radius: 10px; padding: 10px;
    display: flex; flex-direction: column; gap: 8px;
  }
  h3 {
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.7rem;
    text-transform: uppercase; letter-spacing: 0.09em; margin: 0;
  }
  .hint { color: var(--dim); font-size: 0.75rem; margin: 0; line-height: 1.45; }
  .readout { color: var(--acc-yellow); font-family: var(--font-mono); font-size: 0.75rem; margin: 0; }
  .readout b.low { color: var(--acc-blue); }
  .readout b.medium { color: var(--acc-green); }
  .readout b.high { color: var(--acc-orange); }
  .readout b.max { color: var(--acc-magenta); }
  /*
    Label above the field, not beside it. A native date control will not shrink
    below the date it has to display, so on a phone the 74px label was taking
    the room it needed and leaving a stub — the same failure the task editor and
    the fill-in card both had. Side by side returns once there is width for it.
  */
  .field { display: flex; flex-direction: column; align-items: stretch; gap: 4px; }
  .field span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  .field input {
    width: 100%; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 7px 8px; font-size: 0.85rem; outline: none; color-scheme: dark;
  }
  @media (min-width: 440px) {
    .field { flex-direction: row; align-items: center; gap: 8px; }
    .field span { min-width: 74px; }
    .field input { flex: 1; width: auto; }
  }
  .rule { display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--line); padding-top: 8px; }
  .days { display: flex; gap: 4px; }
  .day {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; padding: 6px 0; cursor: pointer;
  }
  .day.on { color: var(--acc-green); border-color: var(--acc-green); }
  .times { display: flex; align-items: center; gap: 6px; }
  .times input {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.8rem;
    padding: 5px 6px; color-scheme: dark;
  }
  .dash { color: var(--dim); }
  .drop { margin-left: auto; background: none; border: none; color: var(--dim); cursor: pointer; padding: 4px 6px; }
  .drop:hover { color: var(--acc-magenta); }
  .rule-adds { display: flex; gap: 6px; flex-wrap: wrap; }
  .rule-adds button {
    background: none; border: 1px dashed var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; padding: 5px 10px; cursor: pointer;
  }
  .rule-adds button:hover { color: var(--acc-cyan); border-color: var(--acc-cyan); }
  .opt { display: flex; gap: 8px; align-items: center; font-size: 0.78rem; color: var(--dim); cursor: pointer; }
  .opt input { width: 15px; height: 15px; accent-color: var(--acc-yellow); }
  .actions { display: flex; gap: 8px; }
  .actions button {
    flex: 1; background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.85rem; padding: 11px; cursor: pointer;
  }
  .actions .primary { color: var(--acc-green); border-color: var(--acc-green); font-weight: 700; }
  .actions .danger { color: var(--acc-magenta); }
  .actions .danger.armed { background: var(--acc-magenta); color: var(--bg0); font-weight: 700; }
</style>
