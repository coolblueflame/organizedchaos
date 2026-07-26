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
    <button class="note story" data-testid="delight-story" onclick={closeStory}>
      <span class="emoji">▚</span>
      <span class="glitch-text">{current.text}</span>
    </button>
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
  .story { border-color: var(--acc-green); background: #0a1208; }
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
  .m-friendly-bsod { background: #1533b8; display: grid; place-items: center; }
  .bsod { color: #fff; font-family: var(--font-mono); text-align: left; max-width: 420px; padding: 20px; }
  .bsod-face { font-size: 4rem; margin: 0 0 12px; }
  .bsod p { margin: 4px 0; }
  .bsod-sub { opacity: 0.75; font-size: 0.8rem; }
</style>
