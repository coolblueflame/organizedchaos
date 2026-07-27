<!--
  Walkthrough for setting up sync. Written for someone who has never made a
  GitHub token before, and honest about what the app can and can't see.
-->
<script lang="ts">
  let { onclose }: { onclose: () => void } = $props();

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

<section class="sheet" data-testid="sync-howto">
  <header>
    <h2>setting up sync</h2>
    <button class="x" data-testid="sync-howto-close" onclick={onclose} aria-label="close">✕</button>
  </header>

  <p class="intro">
    Your tasks live on this device. Connecting sync copies them to a private repository
    that <em>you</em> own, so your other devices can pick them up. Nothing goes to me or
    anyone else — and every change becomes a commit, so you get free version history.
  </p>

  <ol>
    <li>
      <b>Make the repository.</b> On <span class="mono">github.com</span> click
      <span class="mono">+</span> → <b>New repository</b>. Name it anything
      (<span class="mono">organizedchaos-data</span> works), set it to
      <b>Private</b>, and tick <b>Add a README</b> so it isn't empty. Create it.
    </li>
    <li>
      <b>Start a token.</b> Go to your avatar → <b>Settings</b> → scroll to
      <b>Developer settings</b> at the very bottom of the left sidebar →
      <b>Personal access tokens</b> → <b>Fine-grained tokens</b> →
      <b>Generate new token</b>.
    </li>
    <li>
      <b>Name and expiry.</b> Call it whatever you like. Expiry is your call —
      “No expiration” means never doing this again; a dated one is tidier, and the
      app will tell you plainly when it lapses.
    </li>
    <li>
      <b>Limit it to the one repo.</b> Under <b>Repository access</b> pick
      <b>Only select repositories</b> and choose the repo you just made. This is the
      important step: the token can never touch anything else in your account.
    </li>
    <li>
      <b>Give it exactly one permission.</b> Under
      <b>Repository permissions</b> find <b>Contents</b> and set it to
      <b>Read and write</b>. Leave everything else alone.
    </li>
    <li>
      <b>Generate and copy.</b> GitHub shows the
      <span class="mono">github_pat_…</span> string once — copy it now.
    </li>
    <li>
      <b>Paste it here.</b> Close this, fill in the owner (your GitHub username) and
      the repo name, paste the token, and hit <b>connect + sync</b>. Repeat on each
      device; a brand-new device rebuilds everything from the token alone.
    </li>
  </ol>

  <p class="foot">
    Worth knowing: a private repo isn't end-to-end encrypted, so GitHub itself can
    technically read it, and deleted tasks stay in the repo's history. The token is
    stored only on this device and is never included in what gets synced.
  </p>

  <button class="done" onclick={onclose}>got it</button>
</section>

<style>
  .backdrop { position: fixed; inset: 0; background: rgba(4, 6, 10, 0.65); z-index: 190; }
  .sheet {
    position: fixed; z-index: 200; left: 50%; transform: translateX(-50%);
    top: calc(10px + env(safe-area-inset-top));
    width: min(94vw, 560px);
    max-height: calc(100vh - 20px - env(safe-area-inset-top)); overflow-y: auto;
    background: var(--bg1); border: 1px solid var(--acc-blue); border-radius: 14px;
    padding: 16px; box-shadow: 0 12px 48px rgba(0, 0, 0, 0.6);
  }
  header { display: flex; align-items: center; justify-content: space-between; margin-bottom: 8px; }
  h2 {
    color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.8rem;
    text-transform: uppercase; letter-spacing: 0.1em; margin: 0;
  }
  .x { background: none; border: none; color: var(--dim); cursor: pointer; font-size: 0.9rem; padding: 2px 6px; }
  .intro, .foot { color: var(--dim); font-size: 0.82rem; line-height: 1.55; }
  .foot { border-top: 1px solid var(--line); padding-top: 10px; margin-top: 4px; }
  ol { padding-left: 20px; margin: 12px 0; display: flex; flex-direction: column; gap: 10px; }
  li { font-size: 0.85rem; line-height: 1.55; color: var(--text); }
  li b { color: var(--acc-green); font-weight: 600; }
  .mono { font-family: var(--font-mono); color: var(--acc-purple); font-size: 0.8rem; }
  em { color: var(--text); font-style: italic; }
  .done {
    width: 100%; background: var(--bg2); border: 1px solid var(--acc-green); border-radius: 8px;
    color: var(--acc-green); font-family: var(--font-mono); font-weight: 700;
    padding: 11px; cursor: pointer;
  }
</style>
