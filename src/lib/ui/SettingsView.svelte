<!--
  Settings (spec §6): sync connect/status, JSON export backup, tuning knobs.
  The PAT is written straight to device-local kv and shown never again.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import SyncHowTo from './SyncHowTo.svelte';
  import { install } from './install.svelte';
  import { currentPushSubscription, deviceLabel, pushSupported, subscribePush } from './push';
  import Glyph from './Glyph.svelte';
  import LockGate from './LockGate.svelte';
  import { hasPin, lock, setPin } from './lock.svelte';

  let howToOpen = $state(false);
  let pinDraft = $state('');
  /** SW controller present = this device serves the app from cache offline. */
  const offlineReady = typeof navigator !== 'undefined'
    && !!navigator.serviceWorker?.controller;

  let owner = $state('coolblueflame');
  let repoName = $state('organizedchaos-data');
  let token = $state('');
  let connecting = $state(false);
  let connectError = $state('');

  async function connect() {
    if (!token.trim() || connecting) return;
    connecting = true;
    connectError = '';
    const res = await app.configureSync(owner.trim(), repoName.trim(), token.trim());
    connecting = false;
    if (!res.ok) connectError = res.error ?? 'connection failed';
    else token = '';
  }

  async function exportBackup() {
    const snap = await app.exportSnapshot();
    const stamp = new Date().toISOString().slice(0, 10);
    const blob = new Blob([JSON.stringify(snap, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `organizedchaos-backup-${stamp}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const lastSync = $derived(app.lastSyncAt ? new Date(app.lastSyncAt).toLocaleTimeString() : 'never');

  // ── serverless reminders (2026-07-30): the data repo's Action pushes a
  //    morning digest to every device registered here. ──────────────────────
  let remindersOn = $state<boolean | null>(null); // null = still checking
  let reminderBusy = $state(false);
  let reminderError = $state('');

  $effect(() => {
    void currentPushSubscription().then((s) => (remindersOn = s !== null));
  });

  async function enableReminders() {
    if (reminderBusy) return;
    reminderBusy = true;
    reminderError = '';
    try {
      const sub = await subscribePush();
      await app.saveReminderSubscription(sub, deviceLabel(), true);
      remindersOn = true;
    } catch (err) {
      reminderError = err instanceof Error ? err.message : String(err);
    } finally {
      reminderBusy = false;
    }
  }

  async function disableReminders() {
    if (reminderBusy) return;
    reminderBusy = true;
    reminderError = '';
    try {
      const sub = await currentPushSubscription();
      if (sub) {
        await app.saveReminderSubscription(sub, deviceLabel(), false);
        await sub.unsubscribe();
      }
      remindersOn = false;
    } catch (err) {
      reminderError = err instanceof Error ? err.message : String(err);
    } finally {
      reminderBusy = false;
    }
  }

  function setting(patch: Partial<typeof app.state.settings>) {
    void app.updateSettings(patch);
  }
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'home' })}>‹</button>
    <h1>Settings</h1>
  </header>

  <section class="group">
    <h2>this device</h2>
    <p class="hint">
      {#if install.installed}
        Running from your home screen — full screen, offline, and storage the browser
        is far less likely to clear.
      {:else if install.platform === 'other'}
        Install Organized Chaos as its own app — a Dock or taskbar icon, its own
        window, no tab archaeology — and it works offline with sturdier storage.
      {:else}
        Add Organized Chaos to your home screen and it opens full screen, works offline,
        and gets sturdier storage for your tasks.
      {/if}
    </p>
    <button class="link" data-testid="install-howto-open" onclick={() => install.openHowTo()}>
      {install.installed ? 'how installing works →'
        : install.platform === 'other' ? 'how do I install it on this computer? →'
        : 'how do I add it to my home screen? →'}
    </button>
  </section>

  <section class="group">
    <h2>sync</h2>
    {#if app.syncStatus === 'disabled'}
      <p class="hint">
        Syncs through a PRIVATE GitHub repo you own — every change is a commit, so your
        whole todo database gets full version history for free. Needs a fine-grained
        personal access token scoped to just that repo.
      </p>
      <label><span>repo owner</span>
        <input data-testid="settings-owner" bind:value={owner} /></label>
      <label><span>repo name</span>
        <input data-testid="settings-repo" bind:value={repoName} /></label>
      <label><span>access token</span>
        <input data-testid="settings-token" type="password" bind:value={token} placeholder="github_pat_…" /></label>
      <button class="primary" data-testid="settings-connect" disabled={connecting || !token.trim()} onclick={connect}>
        {connecting ? 'connecting…' : 'connect + sync'}
      </button>
      <button class="link" data-testid="sync-howto-open" onclick={() => (howToOpen = true)}>
        how do I make the repo and token? →
      </button>
      {#if connectError}<p class="error" data-testid="settings-connect-error">{connectError}</p>{/if}
    {:else}
      <p class="status" data-testid="settings-sync-status">
        status: <b class={app.syncStatus}>{app.syncStatus}</b>
        {#if app.syncDetail}&nbsp;— {app.syncDetail}{/if}
        &nbsp;· last sync {lastSync}
      </p>
      <div class="row">
        <button data-testid="settings-sync-now" onclick={() => void app.syncNow()}>sync now</button>
        <button class="danger" data-testid="settings-disconnect" onclick={() => void app.disconnectSync()}>disconnect</button>
      </div>
    {/if}
  </section>

  {#if pushSupported()}
    <section class="group" data-testid="settings-reminders">
      <h2>morning reminders</h2>
      <p class="hint">
        A daily push when deadlines are due or overdue — sent each morning by
        your own data repo's free CI. No server anywhere.
      </p>
      {#if app.syncStatus === 'disabled'}
        <p class="hint">connect sync above first — reminders ride on the same repo.</p>
      {:else if remindersOn === null}
        <p class="hint">checking this device…</p>
      {:else if remindersOn}
        <p class="status">this device is registered ✓</p>
        <button data-testid="reminders-disable" disabled={reminderBusy} onclick={() => void disableReminders()}>
          turn off on this device
        </button>
      {:else}
        <button class="primary" data-testid="reminders-enable" disabled={reminderBusy}
          onclick={() => void enableReminders()}>
          enable on this device
        </button>
      {/if}
      {#if reminderError}<p class="error">{reminderError}</p>{/if}
    </section>
  {/if}

  <section class="group">
    <h2>backup & data</h2>
    <button data-testid="settings-export" onclick={exportBackup} class="with-glyph"><Glyph name="install" size={11} /> export everything as JSON</button>
    <button data-testid="settings-import" onclick={() => navigate({ name: 'import' })} class="with-glyph"><Glyph name="upload" size={11} /> import from Things</button>
    <button data-testid="settings-tags" onclick={() => navigate({ name: 'tags' })}>manage tags</button>
    <p class="hint">device storage:
      {#if app.persistentStorage === 'granted'}persistent ✓ (the browser won't evict your data)
      {:else if app.persistentStorage === 'denied'}best-effort — install to the home screen to lock it in
      {:else if app.persistentStorage === 'unsupported'}best-effort (browser doesn't support persistence)
      {:else}checking…{/if}
    </p>
    <p class="hint">offline:
      {#if offlineReady}ready ✓ — the app opens and works without a connection; changes sync when you're back online
      {:else}not cached yet on this device — open it once online (or install it) first{/if}
    </p>
  </section>

  {#if pushSupported()}
    <section class="group" data-testid="settings-alarms">
      <h2>timebox alarms</h2>
      <p class="hint">A tiny scheduler (your own Cloudflare Worker — see
        <code>tools/alarm-worker</code>) pushes the alarm at the exact second,
        even with the phone locked in a pocket. Leave empty and timeboxes work
        exactly as they always have.</p>
      <label><span>worker url</span>
        <input data-testid="alarm-url" placeholder="https://…workers.dev"
          value={app.state.settings.alarmWorkerUrl ?? ''}
          onchange={(e) => setting({ alarmWorkerUrl: e.currentTarget.value.trim() || undefined })} /></label>
      <label><span>alarm secret</span>
        <input data-testid="alarm-secret" type="password" placeholder="the ALARM_SECRET you set"
          value={app.state.settings.alarmWorkerSecret ?? ''}
          onchange={(e) => setting({ alarmWorkerSecret: e.currentTarget.value.trim() || undefined })} /></label>
    </section>
  {/if}

  <section class="group" data-testid="settings-privacy">
    <h2>locked lists</h2>
    {#if hasPin()}
      <p class="hint">A PIN is set. Lock any list from its ⋯ settings sheet; locked lists hide
        their contents and stay out of the dice until unlocked.
        {#if lock.unlocked}This session is <b>unlocked</b>.{:else}This session is <b>locked</b>.{/if}</p>
      {#if lock.unlocked}
        <button data-testid="settings-lock-now" onclick={() => lock.relock()}>lock now</button>
      {:else}
        <LockGate />
      {/if}
      <details>
        <summary class="hint">change PIN</summary>
        <div class="pin-row">
          <input type="password" inputmode="numeric" placeholder="new PIN"
            data-testid="settings-pin-input" bind:value={pinDraft} />
          <button data-testid="settings-pin-save" disabled={pinDraft.length < 4 || !lock.unlocked}
            onclick={() => { void setPin(pinDraft); pinDraft = ''; }}>
            {lock.unlocked ? 'save new PIN' : 'unlock first'}
          </button>
        </div>
      </details>
    {:else}
      <p class="hint">Set a PIN to enable locking lists (from each list's ⋯ sheet). This is a
        privacy screen for shoulder-surfers and borrowed phones — <b>not encryption</b>: the
        data itself is stored and synced like everything else.</p>
      <div class="pin-row">
        <input type="password" inputmode="numeric" placeholder="PIN (4+ characters)"
          data-testid="settings-pin-input" bind:value={pinDraft} />
        <button data-testid="settings-pin-save" disabled={pinDraft.length < 4}
          onclick={() => { void setPin(pinDraft); pinDraft = ''; }}>set PIN</button>
      </div>
    {/if}
  </section>

  <section class="group" data-testid="settings-legend">
    <h2>what the symbols mean</h2>
    <details class="legend">
      <summary>the full legend</summary>
      <h3>on tasks</h3>
      <ul>
        <li><span class="l-prio max"></span><span class="l-prio high"></span><span class="l-prio medium"></span><span class="l-prio low"></span><span class="l-prio someday"></span>
          priority: magenta MAX · orange high · green medium · blue low · grey someday</li>
        <li><span class="l-badge">NEW</span> not triaged yet — open it or set any field</li>
        <li><Glyph name="escalate" size={11} /> a deadline has escalated its effective priority</li>
        <li><Glyph name="play" size={11} /> in progress — the clock may be running</li>
        <li><Glyph name="blocked" size={11} /> waiting on another task; the randomizer skips it</li>
        <li><Glyph name="moon" size={11} /> snoozed — out of the draw until it wakes</li>
        <li><Glyph name="period" size={11} /> daily ritual: magenta = window open now · green = done today · grey = waiting</li>
        <li><Glyph name="timebox" size={11} /> starts a countdown when accepted</li>
        <li><Glyph name="notes" size={11} /> has a description — expand to read it</li>
        <li><Glyph name="box-checked" size={11} /> n/m — a checklist inside, ticked so far</li>
        <li><span class="l-text">⧗</span> time actually tracked on it</li>
        <li><span class="l-text">#N</span> its place in today's queue</li>
        <li>coloured words at the row's end are its tags (first three, then +n)</li>
      </ul>
      <h3>on lists</h3>
      <ul>
        <li><Glyph name="dice" size={11} /> inside its eligible hours — the randomizer draws from it</li>
        <li><Glyph name="moon" size={11} /> outside its hours — asleep until its window</li>
        <li><Glyph name="bolt" size={11} /> MAX-priority tasks get through even while asleep</li>
        <li>the thin bar under a list = how much of the heaviest list's load it carries</li>
        <li><span class="l-text">✦</span> summoned by the dice — a list the app itself made</li>
      </ul>
    </details>
  </section>

  <section class="group">
    <h2>tuning</h2>
    <label><span>focus hours per day (deadline math)</span>
      <input type="number" min="0.5" step="0.5" value={app.state.settings.hoursPerDay}
        onchange={(e) => setting({ hoursPerDay: parseFloat(e.currentTarget.value) || 1 })} /></label>
    <label><span>days of slack per priority band</span>
      <input type="number" min="1" value={app.state.settings.slackBandDays}
        onchange={(e) => setting({ slackBandDays: parseInt(e.currentTarget.value, 10) || 3 })} /></label>
    <label><span>day rolls over at (hour)</span>
      <input type="number" min="0" max="12" value={app.state.settings.rolloverHour}
        onchange={(e) => setting({ rolloverHour: parseInt(e.currentTarget.value, 10) || 4 })} /></label>
    <label class="toggle"><span>auto-select the next task when you complete the current one</span>
      <input type="checkbox" data-testid="settings-autoselect" checked={app.state.settings.autoSelectNext}
        onchange={(e) => setting({ autoSelectNext: e.currentTarget.checked })} /></label>
  </section>

  <p class="about">organized chaos v{__APP_VERSION__} — a todo list with loaded dice</p>
</main>

{#if howToOpen}
  <SyncHowTo onclose={() => (howToOpen = false)} />
{/if}

<style>
  .with-glyph { display: inline-flex; align-items: center; gap: 6px; }
  .pin-row { display: flex; gap: 8px; margin-top: 6px; }
  .pin-row input { flex: 1; min-width: 0; }

  .legend summary { cursor: pointer; color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.8rem; }
  .legend h3 { color: var(--dim); font-family: var(--font-mono); font-size: 0.68rem; text-transform: uppercase; letter-spacing: 0.08em; margin: 12px 0 4px; }
  .legend ul { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 6px; }
  .legend li { display: flex; align-items: baseline; gap: 6px; font-size: 0.8rem; color: var(--text); line-height: 1.45; }
  .legend li :global(svg) { flex: none; transform: translateY(1px); color: var(--dim); }
  .l-prio { width: 8px; height: 8px; border-radius: 50%; flex: none; align-self: center; }
  .l-prio.someday { background: var(--dim); opacity: 0.4; }
  .l-prio.low { background: var(--acc-blue); }
  .l-prio.medium { background: var(--acc-green); }
  .l-prio.high { background: var(--acc-orange); }
  .l-prio.max { background: var(--acc-magenta); }
  .l-badge {
    color: var(--acc-yellow); border: 1px solid color-mix(in srgb, var(--acc-yellow) 55%, transparent);
    border-radius: 4px; padding: 0 4px; flex: none;
    font-family: var(--font-mono); font-size: 0.58rem; font-weight: 700; letter-spacing: 0.06em;
  }
  .l-text { color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; flex: none; }


  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }
  .group {
    background: var(--bg1); border: 1px solid var(--line); border-radius: 10px;
    padding: 14px; margin-bottom: 14px; display: flex; flex-direction: column; gap: 10px;
  }
  h2 {
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.75rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 0;
  }
  .hint, .status { color: var(--dim); font-size: 0.8rem; margin: 0; line-height: 1.5; }
  .status b.idle { color: var(--acc-green); }
  .status b.syncing { color: var(--acc-cyan); }
  .status b.error { color: var(--acc-magenta); }
  .status b.offline { color: var(--acc-orange); }
  label { display: flex; flex-direction: column; gap: 4px; }
  label span { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; }
  input {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 6px;
    color: var(--text); padding: 8px; font-size: 0.9rem; outline: none;
  }
  input:focus { border-color: var(--acc-blue); }
  .toggle { flex-direction: row; align-items: center; justify-content: space-between; gap: 10px; }
  .toggle input { width: 20px; height: 20px; accent-color: var(--acc-green); }
  button {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); font-family: var(--font-mono); font-size: 0.85rem;
    padding: 10px; cursor: pointer;
  }
  .primary { color: var(--acc-green); border-color: var(--acc-green); }
  .primary:disabled { opacity: 0.4; cursor: default; }
  .danger { color: var(--acc-magenta); }
  .row { display: flex; gap: 8px; }
  .row button { flex: 1; }
  .error { color: var(--acc-magenta); font-size: 0.8rem; margin: 0; }
  .about { color: var(--dim); font-family: var(--font-mono); font-size: 0.7rem; text-align: center; margin-top: 20px; }
  .link {
    background: none; border: none; color: var(--acc-blue); cursor: pointer;
    font-size: 0.78rem; padding: 2px; text-align: left; text-decoration: underline;
  }
</style>
