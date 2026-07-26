<script lang="ts">
  import { PRIORITIES, type Priority } from '../domain/types';

  let { value, onchange }: { value: Priority; onchange: (p: Priority) => void } = $props();

  const labels: Record<Priority, string> =
    { someday: 'someday', low: 'low', medium: 'med', high: 'high', max: 'MAX' };
</script>

<div class="seg" role="radiogroup" aria-label="priority">
  {#each PRIORITIES as p (p)}
    <button
      role="radio"
      aria-checked={value === p}
      class="opt {p}"
      class:active={value === p}
      data-testid="priority-{p}"
      onclick={() => onchange(p)}>{labels[p]}</button>
  {/each}
</div>

<style>
  .seg {
    display: flex; border: 1px solid var(--line); border-radius: 8px; overflow: hidden;
  }
  .opt {
    flex: 1; background: none; border: none; color: var(--dim);
    font-family: var(--font-mono); font-size: 0.75rem; padding: 8px 0; cursor: pointer;
  }
  .opt.active { background: var(--bg2); font-weight: 700; }
  .opt.active.someday { color: var(--dim); }
  .opt.active.low { color: var(--acc-blue); }
  .opt.active.medium { color: var(--acc-green); }
  .opt.active.high { color: var(--acc-orange); }
  .opt.active.max { color: var(--acc-magenta); }
</style>
