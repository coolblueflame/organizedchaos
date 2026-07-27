<!--
  How to put Organized Chaos on your home screen. Steps differ per platform,
  so we show the ones that apply rather than a generic list the reader has to
  filter themselves. See install.svelte.ts for why iOS gets prose and Android
  gets a button.
-->
<script lang="ts">
  import { install } from './install.svelte';

  let { onclose }: { onclose: () => void } = $props();

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onclose(); }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  async function installNow() {
    const ok = await install.promptInstall();
    if (ok) onclose();
  }
</script>

<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="backdrop" onclick={onclose}></div>

<section class="sheet" data-testid="install-howto">
  <header>
    <h2>add to your home screen</h2>
    <button class="x" data-testid="install-howto-close" onclick={onclose} aria-label="close">✕</button>
  </header>

  <p class="intro">
    Organized Chaos runs as a normal web page, but it's built to be installed. On your
    home screen it opens full-screen with no browser bars, works offline, and — the part
    that actually matters — your tasks get storage the browser is far less likely to
    clear out on its own.
  </p>

  {#if install.installed}
    <p class="done" data-testid="install-already">
      ✓ You're already running the installed version. Nothing to do.
    </p>
  {/if}

  {#if install.canPromptDirectly}
    <button class="cta" data-testid="install-now" onclick={() => void installNow()}>
      ⬇ install it now
    </button>
    <p class="aside">Your browser can do this in one tap — no menu digging required.</p>
  {/if}

  {#if install.platform === 'ios'}
    <h3>iPhone &amp; iPad</h3>
    <ol data-testid="install-steps-ios">
      <li>Open this page in <b>Safari</b>. (Chrome and Edge work too, from iOS 17 on — but
        an in-app browser, like a link opened inside Slack or Instagram, does not. If you
        got here from another app, tap its <span class="mono">⋯</span> menu and choose
        <b>Open in Safari</b> first.)</li>
      <li>Tap the <b>Share</b> button — the square with an arrow coming out of it, at the
        bottom of the screen on iPhone, at the top on iPad.</li>
      <li>Scroll the share sheet <b>down past the row of apps</b>. This is the step
        everyone misses; the option is below the sharing targets, not among them.</li>
      <li>Tap <b>Add to Home Screen</b>, then <b>Add</b> in the top corner.</li>
    </ol>
    <p class="aside">
      Apple gives web apps no way to trigger this themselves, so these four taps are
      genuinely the only route. Once it's on your home screen it behaves like any
      other app — including its own icon and no address bar.
    </p>
  {:else if install.platform === 'android'}
    <h3>Android</h3>
    <ol data-testid="install-steps-android">
      <li>Open this page in <b>Chrome</b> (Edge, Brave and Samsung Internet all work the
        same way).</li>
      <li>Tap the <span class="mono">⋮</span> menu at the top right.</li>
      <li>Choose <b>Install app</b>, or <b>Add to Home screen</b> if that's what yours
        says — same thing.</li>
      <li>Confirm with <b>Install</b>.</li>
    </ol>
  {:else}
    <h3>Desktop</h3>
    <ol data-testid="install-steps-desktop">
      <li>In Chrome or Edge, look for the <b>install icon</b> at the right-hand end of
        the address bar (a monitor with an arrow), or use the <span class="mono">⋮</span>
        menu → <b>Install Organized Chaos</b>.</li>
      <li>Safari on macOS: <b>File</b> → <b>Add to Dock</b>.</li>
      <li>Firefox doesn't install web apps; it'll keep working as a normal tab.</li>
    </ol>
  {/if}

  <p class="footnote">
    Installing doesn't move your data anywhere — it's the same tasks in the same browser
    storage on this device. To have them on more than one device, set up sync in Settings.
  </p>
</section>

<style>
  .backdrop {
    position: fixed; inset: 0; z-index: 300;
    background: rgba(0, 0, 0, 0.6); backdrop-filter: blur(2px);
  }
  .sheet {
    position: fixed; z-index: 301; left: 50%; transform: translateX(-50%);
    bottom: 0; width: min(560px, 100%); max-height: 86vh; overflow-y: auto;
    background: var(--bg1); border: 1px solid var(--line);
    border-radius: 14px 14px 0 0; padding: 16px 18px calc(22px + env(safe-area-inset-bottom));
  }
  header { display: flex; align-items: center; gap: 10px; margin-bottom: 10px; }
  h2 {
    flex: 1; margin: 0; color: var(--acc-cyan);
    font-family: var(--font-mono); font-size: 0.95rem;
  }
  h3 {
    color: var(--acc-yellow); font-family: var(--font-mono);
    font-size: 0.78rem; margin: 16px 0 6px;
  }
  .x { background: none; border: none; color: var(--dim); cursor: pointer; font-size: 0.9rem; }
  .intro, .aside, .footnote, .done { color: var(--dim); font-size: 0.78rem; line-height: 1.5; }
  .intro { margin: 0 0 4px; }
  .aside { margin: 8px 0 0; font-size: 0.72rem; }
  .footnote {
    margin: 16px 0 0; padding-top: 12px; border-top: 1px solid var(--line); font-size: 0.72rem;
  }
  .done { color: var(--acc-green); margin: 10px 0 0; }
  ol { margin: 0; padding-left: 20px; }
  ol li { color: var(--text); font-size: 0.8rem; line-height: 1.55; margin-bottom: 8px; }
  .mono { font-family: var(--font-mono); color: var(--acc-cyan); }
  .cta {
    width: 100%; margin-top: 12px;
    background: var(--acc-cyan); border: none; border-radius: 9px; color: var(--bg0);
    font-family: var(--font-mono); font-size: 0.82rem; font-weight: 700;
    padding: 11px 14px; cursor: pointer;
  }
</style>
