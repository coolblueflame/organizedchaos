<!--
  Month and day, no year. Shared by ENTROPY's question and Settings. The day
  list follows the month, with 29 February always offered: the season engine
  keeps a leap-day birthday on the 28th in the other years.
-->
<script lang="ts">
  let { month = $bindable(1), day = $bindable(1) }: { month?: number; day?: number } = $props();

  const MONTHS = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  /** Days in each month, counting 29 February. */
  const LENGTHS = [31, 29, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

  const days = $derived(Array.from({ length: LENGTHS[month - 1]! }, (_, i) => i + 1));

  // A day past the end of a newly chosen month settles on its last day.
  $effect(() => { if (day > LENGTHS[month - 1]!) day = LENGTHS[month - 1]!; });
</script>

<div class="picker">
  <select data-testid="birthday-month" aria-label="month" bind:value={month}>
    {#each MONTHS as name, i (name)}<option value={i + 1}>{name}</option>{/each}
  </select>
  <select data-testid="birthday-day" aria-label="day" bind:value={day}>
    {#each days as d (d)}<option value={d}>{d}</option>{/each}
  </select>
</div>

<style>
  .picker { display: flex; gap: 8px; }
  select {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 8px; font-size: 0.9rem;
  }
</style>
