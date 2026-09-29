<!--
  The story so far (#/story): every beat the reader has read and dismissed,
  gathered into chapters, so one that continues the last can be read with
  what came before it. Never a beat further — see domain/story.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { navigate } from './router.svelte';
  import { storySoFar } from '../domain/story';
  import { STORY_BEATS } from '../eggs/content/extras';

  const chapters = $derived(storySoFar(STORY_BEATS, app.eggStoryStage));
  const caughtUp = $derived(app.eggStoryStage >= STORY_BEATS.length);
</script>

<main>
  <header>
    <button data-testid="back" class="back" onclick={() => navigate({ name: 'stats' })}>‹</button>
    <h1>The Story So Far</h1>
  </header>

  {#if chapters.length === 0}
    <p class="empty" data-testid="story-empty">// nothing here yet. the app will say when it has something to say.</p>
  {:else}
    <p class="byline">// organizedchaos.exe, collected</p>
    {#each chapters as chapter (chapter.title)}
      <section class="chapter" data-testid="story-chapter">
        <h2>{chapter.title}</h2>
        {#each chapter.beats as beat (beat.index)}
          <p class="beat" data-testid="story-beat">{beat.text}</p>
        {/each}
      </section>
    {/each}
    <p class="coda" data-testid="story-coda">{caughtUp ? 'the end, for now.' : 'to be continued.'}</p>
  {/if}
</main>

<style>
  main { max-width: 640px; margin: 0 auto; padding: 24px 16px calc(48px + env(safe-area-inset-bottom)); }
  header { display: flex; align-items: center; gap: 8px; margin-bottom: 16px; }
  .back { background: none; border: none; color: var(--acc-blue); font-size: 1.6rem; cursor: pointer; padding: 0 8px; }
  h1 { font-family: var(--font-mono); font-size: 1.2rem; margin: 0; }

  .byline, .empty, .coda {
    font-family: var(--font-mono); font-size: 0.75rem; color: var(--dim); margin: 0 0 14px;
  }
  .coda { margin-top: 18px; text-align: center; color: var(--acc-green); }

  /* The story's own voice is the green terminal of its dialog window; the
     page borrows the colour and the rule, not the chrome. */
  .chapter { margin-bottom: 18px; }
  h2 {
    font-family: var(--font-mono); font-size: 0.72rem; text-transform: uppercase;
    letter-spacing: 0.1em; color: var(--acc-green); margin: 0 0 8px;
  }
  .beat {
    margin: 0 0 10px; padding-left: 12px;
    border-left: 2px solid rgb(126 231 135 / 0.35);
    color: var(--text); font-size: 0.92rem; line-height: 1.55;
    overflow-wrap: anywhere;
  }
</style>
