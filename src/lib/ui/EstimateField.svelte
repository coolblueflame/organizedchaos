<!--
  One estimate input, used everywhere an estimate is typed.

  It exists because the obvious version has a nasty flaw. Binding the input
  straight to the stored number means every keystroke parses, saves, and then
  RE-RENDERS the field from what was saved — so typing "45m" got as far as the
  "m", stored 0.75 correctly, and replaced the text under the cursor with
  "0.75". Carry on typing "45min" and the field ends up reading "0.75in".

  So the field owns its text while you are in it, and only takes a value from
  outside when you are not. What it shows on the way back is the compact form
  (0.75 → "45m"), because reading back what you typed is the confirmation that
  you were understood.
-->
<script lang="ts">
  import { ESTIMATE_HINT, formatEstimate, parseEstimate } from '../domain/estimate';

  let { hours, testid, onchange }: {
    hours: number | undefined;
    testid: string;
    /** undefined means "no estimate" — a cleared field, not a parse failure. */
    onchange: (hours: number | undefined) => void;
  } = $props();

  let el: HTMLInputElement | undefined = $state();
  // svelte-ignore state_referenced_locally
  let draft = $state(formatEstimate(hours));

  /*
    Adopt an outside change only while the user is elsewhere — switching to
    another task, or an edit arriving from another device. Reseeding a focused
    field is exactly the bug this component exists to prevent.
  */
  $effect(() => {
    const incoming = formatEstimate(hours);
    if (el && document.activeElement === el) return;
    draft = incoming;
  });

  /**
   * A bare "30" means 30 HOURS, and at least once that was meant as minutes
   * — a 30h guitar practice inflated the burden delta by a day (2026-08-12).
   * Ten-plus bare hours earns a one-tap corrector, never a blocker: real
   * 12h epics just ignore it.
   */
  let suspicious = $state<number | null>(null);

  function commit(text: string) {
    draft = text;
    const trimmed = text.trim();
    if (trimmed === '') {
      suspicious = null;
      onchange(undefined);
      return;
    }
    const parsed = parseEstimate(trimmed);
    // Half-typed input ("45mi") is not a request to wipe the estimate; leave
    // whatever was last understood in place and wait for the rest.
    if (parsed !== null) {
      suspicious = /^\d+$/.test(trimmed) && parsed >= 10 ? parsed : null;
      onchange(parsed);
    }
  }

  function meantMinutes() {
    if (suspicious === null) return;
    const hoursFromMinutes = suspicious / 60;
    suspicious = null;
    onchange(hoursFromMinutes);
    draft = formatEstimate(hoursFromMinutes);
  }

  /** Leaving tidies "90m" into "1h 30m" — same value, said the shorter way. */
  function tidy() {
    draft = formatEstimate(hours);
  }
</script>

<input type="text" data-testid={testid} placeholder={ESTIMATE_HINT}
  bind:this={el} value={draft}
  oninput={(e) => commit(e.currentTarget.value)}
  onblur={tidy} />
{#if suspicious !== null}
  <button class="meant-minutes" data-testid="{testid}-meant-minutes" onclick={meantMinutes}>
    that's {suspicious} hours — meant {suspicious}m?
  </button>
{/if}

<style>
  /*
    Its own look, because scoped styles do not cross into a component — the
    three screens that use this all dressed their inputs identically, so the
    shared version is simply that. Parents constrain WIDTH via :global(), which
    is layout rather than appearance and genuinely theirs to decide.
  */
  input {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 7px 8px; font-size: 0.85rem; outline: none;
    width: 100%; min-width: 0; font-family: inherit;
  }
  input:focus { border-color: var(--acc-blue); }
  .meant-minutes {
    display: block; margin-top: 4px;
    background: none; border: none; padding: 0; cursor: pointer;
    color: var(--acc-orange); font-family: var(--font-mono); font-size: 0.7rem;
    text-align: left; text-decoration: underline;
  }
</style>
