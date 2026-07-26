<!--
  Settings (spec §6): sync connect/status, JSON export backup, tuning knobs.
  The PAT is written straight to device-local kv and shown never again.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';

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

  <section class="group">
    <h2>backup & data</h2>
    <button data-testid="settings-export" onclick={exportBackup}>⬇ export everything as JSON</button>
    <button data-testid="settings-import" onclick={() => navigate({ name: 'import' })}>⬆ import from Things</button>
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

  <p class="about">organized chaos v{__APP_VERSION__} — a todo list with a gambling problem</p>
</main>

<style>
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
</style>
