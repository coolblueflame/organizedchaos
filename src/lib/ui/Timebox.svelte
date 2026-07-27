<!--
  The timebox: pick a window, get a live countdown on the current task, and a
  hard-to-miss alert when it runs out.

  Honest limits of a web app on iOS: with no server there is no true push, and
  iOS won't run our code once the app is closed. So we alert with everything
  available while the app is alive — a flashing zeroed clock, a burst, haptics,
  a sound, plus an OS notification when permission has been granted (which
  fires even if the app is merely backgrounded on desktop). See docs.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import type { Task } from '../domain/types';
  import { burstAt, motionOk } from './fx/particles';
  import { haptic } from './fx/haptics';
  import Glyph from './Glyph.svelte';

  let { task }: { task: Task } = $props();

  const PRESETS = [5, 15, 30, 60];

  let picking = $state(false);
  let custom = $state('25');
  let now = $state(Date.now());
  let alerted = $state(false);

  const endsAt = $derived(task.timeboxEndsAt);
  const remainingMs = $derived(endsAt ? endsAt - now : null);
  const expired = $derived(remainingMs !== null && remainingMs <= 0);

  /** Ticks once a second only while a box is actually running. */
  $effect(() => {
    if (!endsAt) return;
    const id = setInterval(() => (now = Date.now()), 1000);
    return () => clearInterval(id);
  });

  // Reset the alert latch whenever a new box starts.
  $effect(() => {
    if (endsAt) alerted = false;
  });

  $effect(() => {
    if (!expired || alerted) return;
    alerted = true;
    fireAlert();
  });

  function fireAlert() {
    haptic('heavy');
    try {
      if (motionOk()) burstAt(window.innerWidth / 2, window.innerHeight / 3, { count: 30, power: 1.4 });
    } catch { /* fx never block the alert */ }
    void notify();
    beep();
    app.fireEgg('timeboxFinished');
  }

  /** OS-level notification when we're allowed one; silently skipped otherwise. */
  async function notify() {
    try {
      if (!('Notification' in window)) return;
      if (Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission !== 'granted') return;
      const body = `"${task.name || 'your task'}" — time's up.`;
      const reg = await navigator.serviceWorker?.getRegistration();
      // Via the service worker when possible: those survive a backgrounded tab.
      if (reg) await reg.showNotification('⏳ Timebox finished', { body, tag: 'timebox' });
      else new Notification('⏳ Timebox finished', { body });
    } catch { /* notifications are a bonus, never a requirement */ }
  }

  /** A short chime built in code — no asset, works offline. */
  function beep() {
    try {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx();
      const gain = ctx.createGain();
      gain.connect(ctx.destination);
      [880, 1320].forEach((freq, i) => {
        const osc = ctx.createOscillator();
        osc.type = 'sine';
        osc.frequency.value = freq;
        osc.connect(gain);
        const start = ctx.currentTime + i * 0.18;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.25, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.16);
        osc.start(start);
        osc.stop(start + 0.18);
      });
      setTimeout(() => void ctx.close(), 800);
    } catch { /* muted device, autoplay policy — fine */ }
  }

  function clock(ms: number): string {
    const total = Math.max(0, Math.round(ms / 1000));
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    const pad = (n: number) => String(n).padStart(2, '0');
    return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
  }

  async function start(minutes: number) {
    picking = false;
    await app.startTimebox(task.id, minutes);
  }
</script>

{#if endsAt}
  <button class="running" class:expired data-testid="timebox-running"
    onclick={() => void app.clearTimebox(task.id)}
    title="tap to stop the timer">
    <span class="clock">{expired ? '0:00' : clock(remainingMs ?? 0)}</span>
    <span class="label">{expired ? "time's up — tap to clear" : 'remaining'}</span>
  </button>
{:else if picking}
  <div class="picker" data-testid="timebox-picker">
    {#each PRESETS as m (m)}
      <button data-testid="timebox-{m}" onclick={() => void start(m)}>{m}m</button>
    {/each}
    <span class="custom">
      <input type="number" min="1" max="600" data-testid="timebox-custom" bind:value={custom} />
      <button data-testid="timebox-custom-go" onclick={() => void start(parseInt(custom, 10) || 0)}>go</button>
    </span>
    <button class="cancel" onclick={() => (picking = false)}>✕</button>
  </div>
{:else}
  <button class="start" data-testid="timebox-open" onclick={() => (picking = true)}>
    <Glyph name="timebox" size={11} /> timebox
  </button>
{/if}

<style>
  .start {
    display: inline-flex; align-items: center; gap: 5px;
    background: none; border: 1px solid var(--line); border-radius: 8px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 6px 10px; cursor: pointer;
  }
  .start:hover { color: var(--acc-yellow); border-color: var(--acc-yellow); }
  .picker { display: flex; flex-wrap: wrap; gap: 6px; align-items: center; }
  .picker button {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--acc-yellow); font-family: var(--font-mono); font-size: 0.72rem;
    padding: 6px 10px; cursor: pointer;
  }
  .custom { display: flex; gap: 4px; align-items: center; }
  .custom input {
    width: 58px; background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.72rem; padding: 5px 6px;
  }
  .picker .cancel { color: var(--dim); border-color: transparent; }
  .running {
    display: flex; flex-direction: column; align-items: center; gap: 1px;
    background: var(--bg2); border: 1px solid var(--acc-yellow); border-radius: 8px;
    color: var(--acc-yellow); padding: 5px 12px; cursor: pointer;
  }
  .clock { font-family: var(--font-mono); font-size: 1rem; font-weight: 700; letter-spacing: 0.04em; }
  .label { font-family: var(--font-mono); font-size: 0.55rem; color: var(--dim); text-transform: uppercase; }
  .running.expired {
    border-color: var(--acc-magenta); color: var(--acc-magenta);
    animation: timebox-flash 0.9s steps(1) infinite;
  }
  @keyframes timebox-flash {
    50% { background: var(--acc-magenta); color: var(--bg0); }
  }
  @media (prefers-reduced-motion: reduce) {
    .running.expired { animation: none; background: var(--acc-magenta); color: var(--bg0); }
  }
</style>
