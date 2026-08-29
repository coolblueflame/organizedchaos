<!--
  Renders whatever the presenter holds: notes, story beats, trivia, unlocks,
  and the short visual moments. Also hosts the input-sequence listeners.
  Every branch closes in one tap; moments are time-boxed by the presenter.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { presenter } from './presenter.svelte';
  import { burstAt } from '../ui/fx/particles';
  import { haptic } from '../ui/fx/haptics';
  import { focusOnMount } from '../ui/focusOnMount';

  let picked = $state<number | null>(null);

  const current = $derived(presenter.current);

  function answer(i: number) {
    if (current?.kind !== 'trivia' || picked !== null) return;
    picked = i;
    const correct = i === current.q.answer;
    app.recordTrivia(correct);
    if (correct) haptic('success');
  }

  function closeTrivia() {
    picked = null;
    presenter.dismiss();
  }

  /**
   * The reader pressed OK: only now is the beat told.
   *
   * Advancing merely because a beat APPEARED would lose one to any glance
   * away — the story is finite, ordered, and each beat fires once, so a beat
   * that vanishes unread can never come back. Two things make acknowledgement
   * safe as the only trigger: the presenter refuses to clear a story card
   * incidentally, and the engine remembers an unacknowledged beat across
   * restarts and re-tells it. Without both, advancing here strands the arc —
   * a beat marked seen while the stage stays put gates every later beat
   * behind a stage that can never arrive.
   */
  function closeStory() {
    if (current?.kind === 'story') app.advanceStory(current.stage);
    presenter.dismiss();
  }

  // On unlock display: confetti-adjacent celebration.
  $effect(() => {
    if (current?.kind === 'unlock') {
      burstAt(window.innerWidth / 2, 120, { count: 30, power: 1.2 });
      haptic('success');
    }
    if (current?.kind === 'moment') haptic('tick');
    if (current?.kind !== 'trivia') picked = null;
  });

  /**
   * "Until you click away": notes and awards no longer expire on a timer, so
   * any interaction elsewhere in the app clears them. Listens on the capture
   * phase and never stops propagation — the tap does its normal job as well,
   * so getting on with your work dismisses the note as a side effect rather
   * than costing an extra tap. The presenter ignores this inside its own
   * protected window, so a tap already in flight can't wipe it unread.
   */
  $effect(() => {
    // Story beats own the screen until acknowledged (see closeStory), so they
    // do not listen for the tap that dismisses everything else.
    if (!current || current.kind === 'trivia' || current.kind === 'moment' || current.kind === 'story') return;
    const away = () => presenter.dismissAway();
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  });

  // ── input sequences (desktop keys; mobile gets the wordmark tap ritual) ──
  const KONAMI = ['ArrowUp', 'ArrowUp', 'ArrowDown', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'ArrowLeft', 'ArrowRight', 'b', 'a'];
  let keyBuf: string[] = [];
  let wordBuf = '';

  $effect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      keyBuf = [...keyBuf, e.key].slice(-KONAMI.length);
      if (KONAMI.every((k, i) => keyBuf[i]?.toLowerCase() === k.toLowerCase())) {
        keyBuf = [];
        app.grantUnlockAndShow('konami');
        presenter.show({ kind: 'moment', moment: 'rainbow-wave' });
      }
      if (/^[a-z]$/i.test(e.key)) {
        wordBuf = (wordBuf + e.key.toLowerCase()).slice(-5);
        if (wordBuf === 'chaos') {
          wordBuf = '';
          app.grantUnlockAndShow('chaos-word');
          presenter.show({ kind: 'moment', moment: 'disco' });
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ── canvas moments ──
  let canvasEl = $state<HTMLCanvasElement | null>(null);

  $effect(() => {
    if (current?.kind !== 'moment' || !canvasEl) return;
    const ctx = canvasEl.getContext('2d');
    if (!ctx) return;
    canvasEl.width = window.innerWidth;
    canvasEl.height = window.innerHeight;
    let raf = 0;
    const W = canvasEl.width;
    const H = canvasEl.height;

    if (current.moment === 'matrix-rain') {
      const cols = Math.floor(W / 16);
      const drops = Array.from({ length: cols }, () => Math.random() * -40);
      const glyphs = 'アカサタナハマヤラワ0123456789ABCDEF<>{}[]=+*#';
      const draw = () => {
        ctx.fillStyle = 'rgba(11,14,20,0.12)';
        ctx.fillRect(0, 0, W, H);
        ctx.fillStyle = '#7ee787';
        ctx.font = '15px monospace';
        drops.forEach((y, i) => {
          ctx.fillText(glyphs[Math.floor(Math.random() * glyphs.length)]!, i * 16, y * 16);
          drops[i] = y * 16 > H && Math.random() > 0.97 ? 0 : y + 1;
        });
        raf = requestAnimationFrame(draw);
      };
      draw();
    } else if (current.moment === 'starfield') {
      const stars = Array.from({ length: 220 }, () => ({
        x: Math.random() * W - W / 2, y: Math.random() * H - H / 2, z: Math.random() * W,
      }));
      const draw = () => {
        ctx.fillStyle = 'rgba(11,14,20,0.35)';
        ctx.fillRect(0, 0, W, H);
        for (const s of stars) {
          s.z -= 8;
          if (s.z <= 0) s.z = W;
          const k = 128 / s.z;
          const px = s.x * k + W / 2;
          const py = s.y * k + H / 2;
          const size = Math.max(0.5, (1 - s.z / W) * 3.5);
          ctx.fillStyle = '#c9d1d9';
          ctx.fillRect(px, py, size, size);
        }
        raf = requestAnimationFrame(draw);
      };
      draw();
    } else if (current.moment === 'confetti-storm') {
      let bursts = 0;
      const interval = setInterval(() => {
        burstAt(Math.random() * W, Math.random() * H * 0.6, { count: 18, power: 1.3 });
        if (++bursts >= 6) clearInterval(interval);
      }, 350);
      return () => clearInterval(interval);
    }
    return () => cancelAnimationFrame(raf);
  });
</script>

{#if current}
  {#if current.kind === 'note'}
    <button class="note accent-{current.accent ?? 'purple'}" data-testid="delight-note" onclick={() => presenter.dismiss()}>
      {#if current.emoji}<span class="emoji">{current.emoji}</span>{/if}
      <span>{current.text}</span>
    </button>
  {:else if current.kind === 'story'}
    <!--
      A beat gets a WINDOW, not a tooltip (2026-08-29 ask): the story is the
      one thing here that can only ever be told once, so it waits to be
      acknowledged instead of yielding to the next tap. Dressed as a system
      dialog from an older machine, because the teller is supposedly the app
      itself and this is the only surface where it speaks as software.
    -->
    <div class="story-backdrop" data-testid="delight-story">
      <div class="xp-window">
        <div class="xp-title">
          <span class="xp-name">organizedchaos.exe</span>
          <span class="xp-buttons" aria-hidden="true">
            <span class="xp-btn">_</span><span class="xp-btn">□</span><span class="xp-btn x">✕</span>
          </span>
        </div>
        <div class="xp-body">
          <span class="xp-icon" aria-hidden="true">▚</span>
          <p class="glitch-text">{current.text}</p>
        </div>
        <div class="xp-actions">
          <button class="xp-ok" data-testid="delight-story-ok" use:focusOnMount onclick={closeStory}>OK</button>
        </div>
      </div>
    </div>
  {:else if current.kind === 'unlock'}
    <button class="note unlock" data-testid="delight-unlock" onclick={() => presenter.dismiss()}>
      <span class="emoji">🏆</span>
      <span><b>DISCOVERY:</b> {current.label}</span>
    </button>
  {:else if current.kind === 'trivia'}
    <div class="trivia-backdrop" data-testid="delight-trivia">
      <div class="trivia">
        <p class="trivia-head">⚡ pop quiz <span class="score">({app.eggTrivia.correct}/{app.eggTrivia.total} lifetime)</span></p>
        <p class="trivia-q">{current.q.q}</p>
        {#each current.q.choices as choice, i (choice)}
          <button
            class="choice"
            class:right={picked !== null && i === current.q.answer}
            class:wrong={picked === i && i !== current.q.answer}
            data-testid="trivia-choice-{i}"
            onclick={() => answer(i)}>{choice}</button>
        {/each}
        {#if picked !== null}
          <p class="reveal">{picked === current.q.answer ? '✓ correct!' : '✗ not quite.'}
            {#if current.q.reveal}&nbsp;{current.q.reveal}{/if}</p>
        {/if}
        <button class="close" data-testid="trivia-close" onclick={closeTrivia}>
          {picked === null ? 'skip' : 'nice'}
        </button>
      </div>
    </div>
  {:else if current.kind === 'moment'}
    <button class="moment m-{current.moment}" data-testid="delight-moment" aria-label="dismiss" onclick={() => presenter.dismiss()}>
      {#if current.moment === 'matrix-rain' || current.moment === 'starfield' || current.moment === 'confetti-storm'}
        <canvas bind:this={canvasEl}></canvas>
      {:else if current.moment === 'friendly-bsod'}
        <div class="bsod">
          <p class="bsod-face">:)</p>
          <p>Your productivity ran into a task and finished it.</p>
          <p class="bsod-sub">100% complete. This was not an error. Tap to continue being great.</p>
        </div>
      {/if}
    </button>
  {/if}
{/if}

<style>
  .note {
    position: fixed; top: calc(12px + env(safe-area-inset-top)); left: 50%;
    transform: translateX(-50%);
    max-width: min(92vw, 480px);
    display: flex; gap: 10px; align-items: flex-start; text-align: left;
    background: var(--bg2); border: 1px solid var(--acc-purple); border-radius: 12px;
    color: var(--text); font-size: 0.85rem; line-height: 1.45;
    padding: 12px 16px; cursor: pointer; z-index: 300;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.6);
    animation: note-in 0.35s cubic-bezier(0.2, 1.4, 0.4, 1);
  }
  @keyframes note-in { from { opacity: 0; transform: translate(-50%, -16px); } }
  .accent-orange { border-color: var(--acc-orange); }
  .accent-cyan { border-color: var(--acc-cyan); }
  .emoji { flex: none; }
  .unlock { border-color: var(--acc-yellow); }
  .unlock b { color: var(--acc-yellow); font-family: var(--font-mono); font-size: 0.7rem; }
  .story-backdrop {
    position: fixed; inset: 0; z-index: 400;
    display: flex; align-items: center; justify-content: center; padding: 16px;
    background: rgb(0 0 0 / 0.45);
  }
  /*
    Deliberately square where the rest of the app is round: this is the app
    talking as a program, and the join is the joke. Green throughout, so it
    still reads as this app's own voice rather than a borrowed screenshot.
  */
  .xp-window {
    width: min(92vw, 420px);
    background: #0a1208;
    border: 2px solid var(--acc-green);
    border-radius: 6px 6px 4px 4px;
    box-shadow: 0 18px 50px rgb(0 0 0 / 0.6), inset 0 0 0 1px rgb(126 231 135 / 0.15);
    animation: xp-open 0.16s ease-out;
  }
  @keyframes xp-open { from { opacity: 0; transform: scale(0.94); } }
  @media (prefers-reduced-motion: reduce) { .xp-window { animation: none; } }
  .xp-title {
    display: flex; align-items: center; justify-content: space-between; gap: 8px;
    padding: 5px 6px 5px 10px;
    background: linear-gradient(180deg, #1c3a1c, #0f2410);
    border-bottom: 1px solid var(--acc-green);
    border-radius: 4px 4px 0 0;
    font-family: var(--font-mono); font-size: 0.72rem; color: var(--acc-green);
  }
  .xp-name { letter-spacing: 0.04em; }
  .xp-buttons { display: inline-flex; gap: 4px; }
  .xp-btn {
    display: inline-flex; align-items: center; justify-content: center;
    width: 16px; height: 14px; font-size: 0.6rem; line-height: 1;
    background: #14261a; border: 1px solid rgb(126 231 135 / 0.5); border-radius: 2px;
    color: rgb(126 231 135 / 0.75);
  }
  /* Inert chrome, and it says so: the OK button is the only way out. */
  .xp-btn.x { color: rgb(126 231 135 / 0.4); }
  .xp-body { display: flex; gap: 10px; padding: 16px 14px 12px; align-items: flex-start; }
  .xp-icon { color: var(--acc-green); font-size: 1.4rem; line-height: 1; flex: none; }
  .xp-body p { margin: 0; color: var(--text); font-size: 0.9rem; line-height: 1.5; }
  .xp-actions {
    display: flex; justify-content: flex-end; gap: 8px;
    padding: 0 14px 14px;
  }
  .xp-ok {
    min-width: 84px; padding: 6px 14px; cursor: pointer;
    background: linear-gradient(180deg, #1c3a1c, #102a12);
    border: 1px solid var(--acc-green); border-radius: 3px;
    color: var(--acc-green); font-family: var(--font-mono); font-size: 0.8rem;
    box-shadow: inset 0 1px 0 rgb(126 231 135 / 0.25);
  }
  .xp-ok:focus-visible { outline: 2px solid var(--acc-green); outline-offset: 2px; }
  @media (hover: hover) { .xp-ok:hover { background: var(--acc-green); color: var(--bg0); } }
  .xp-ok:active { transform: translateY(1px); }
  .glitch-text { font-family: var(--font-mono); color: var(--acc-green); font-size: 0.8rem; }

  .trivia-backdrop {
    position: fixed; inset: 0; z-index: 300; display: grid; place-items: center;
    background: rgba(11, 14, 20, 0.75); padding: 16px;
  }
  .trivia {
    background: var(--bg1); border: 1px solid var(--acc-cyan); border-radius: 14px;
    padding: 18px; max-width: 440px; width: 100%;
    display: flex; flex-direction: column; gap: 8px;
  }
  .trivia-head { color: var(--acc-cyan); font-family: var(--font-mono); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.1em; margin: 0; }
  .score { opacity: 0.7; text-transform: none; letter-spacing: 0; }
  .trivia-q { margin: 0 0 4px; font-size: 0.95rem; }
  .choice {
    background: var(--bg2); border: 1px solid var(--line); border-radius: 8px;
    color: var(--text); text-align: left; padding: 10px 12px; cursor: pointer; font-size: 0.85rem;
  }
  .choice:hover { border-color: var(--acc-cyan); }
  .choice.right { border-color: var(--acc-green); color: var(--acc-green); }
  .choice.wrong { border-color: var(--acc-magenta); color: var(--acc-magenta); }
  .reveal { color: var(--dim); font-size: 0.8rem; margin: 4px 0 0; }
  .close {
    align-self: flex-end; background: none; border: 1px solid var(--line); border-radius: 6px;
    color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; padding: 6px 14px; cursor: pointer;
  }

  .moment {
    position: fixed; inset: 0; z-index: 400; border: none; padding: 0; cursor: pointer;
    background: transparent;
  }
  .moment canvas { position: absolute; inset: 0; width: 100%; height: 100%; }
  .m-matrix-rain, .m-starfield { background: rgba(11, 14, 20, 0.9); }
  .m-rainbow-wave {
    background: linear-gradient(115deg,
      rgba(121,192,255,0.25), rgba(210,168,255,0.25), rgba(126,231,135,0.25),
      rgba(255,166,87,0.25), rgba(247,120,186,0.25), rgba(121,192,255,0.25));
    background-size: 400% 400%;
    animation: rainbow-slide 1.2s linear infinite;
  }
  @keyframes rainbow-slide { to { background-position: 100% 100%; } }
  .m-invert-blip { background: var(--text); mix-blend-mode: difference; animation: blip 0.6s steps(2) forwards; }
  @keyframes blip { 60% { opacity: 1; } 100% { opacity: 0; } }
  .m-disco { animation: disco-spin 0.8s linear infinite; background: rgba(11,14,20,0.2); backdrop-filter: hue-rotate(0deg) saturate(1.8); }
  @keyframes disco-spin { to { backdrop-filter: hue-rotate(360deg) saturate(1.8); } }
  .m-crt-flicker {
    background: repeating-linear-gradient(0deg, rgba(126,231,135,0.06) 0 1px, transparent 1px 3px);
    animation: crt 0.12s steps(2) infinite;
  }
  @keyframes crt { 50% { opacity: 0.6; transform: translateY(1px); } }
  .m-aurora {
    /* Sheets of light drifting over the dark — soft, unlike the loud ones. */
    background:
      radial-gradient(120% 60% at 20% 110%, rgba(126, 231, 135, 0.22), transparent 60%),
      radial-gradient(120% 60% at 80% 115%, rgba(121, 192, 255, 0.20), transparent 60%),
      radial-gradient(140% 70% at 50% 120%, rgba(210, 168, 255, 0.16), transparent 65%),
      rgba(11, 14, 20, 0.35);
    background-size: 220% 220%, 220% 220%, 220% 220%, 100% 100%;
    animation: aurora-drift 2.6s ease-in-out infinite alternate;
  }
  @keyframes aurora-drift {
    from { background-position: 0% 100%, 100% 100%, 50% 100%, 0 0; }
    to { background-position: 60% 40%, 30% 55%, 70% 45%, 0 0; }
  }
  .m-friendly-bsod { background: #1533b8; display: grid; place-items: center; }
  .bsod { color: #fff; font-family: var(--font-mono); text-align: left; max-width: 420px; padding: 20px; }
  .bsod-face { font-size: 4rem; margin: 0 0 12px; }
  .bsod p { margin: 4px 0; }
  .bsod-sub { opacity: 0.75; font-size: 0.8rem; }
</style>
