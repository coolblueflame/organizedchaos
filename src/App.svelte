<!--
  Placeholder shell for Phase 1: proves the theme tokens, build pipeline, and deploy.
  Replaced by the real Home screen in Phase 2.
-->
<main>
  <h1 class="wordmark">organized<span class="accent">chaos</span><span class="cursor">▊</span></h1>
  <p class="tagline">// a todo list with a gambling problem</p>
  <div class="swatches">
    {#each ['--acc-blue', '--acc-purple', '--acc-green', '--acc-orange', '--acc-cyan', '--acc-magenta', '--acc-yellow'] as c (c)}
      <span class="dot" style="background: var({c})"></span>
    {/each}
  </div>
  <p class="version">v{__APP_VERSION__}</p>
</main>

<style>
  main { min-height: 100vh; display: grid; place-content: center; text-align: center; gap: 12px; }
  .wordmark { font-family: var(--font-mono); font-size: 2rem; margin: 0; font-weight: 600; }
  .accent { color: var(--acc-purple); }
  .cursor { color: var(--acc-green); animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .tagline { color: var(--dim); font-family: var(--font-mono); font-size: 0.9rem; margin: 0; }
  .swatches { display: flex; gap: 8px; justify-content: center; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .version { color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }
</style>
