<!-- Home screen — fleshed out in P2.4 (lists), P3 (randomizer/current), P8 (stats). -->
<main>
  <h1 class="wordmark">organized<span class="accent">chaos</span><span class="cursor">▊</span></h1>
  <p class="tagline">// a todo list with a gambling problem</p>
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  .wordmark { font-family: var(--font-mono); font-size: 1.5rem; margin: 0; font-weight: 600; }
  .accent { color: var(--acc-purple); }
  .cursor { color: var(--acc-green); animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .tagline { color: var(--dim); font-family: var(--font-mono); font-size: 0.8rem; margin: 4px 0 20px; }
</style>
