<!--
  Renders whatever the presenter holds: notes, story beats, trivia, unlocks,
  and the short visual moments. Also hosts the input-sequence listeners.
  Every branch closes in one tap; moments are time-boxed by the presenter.
-->
<script lang="ts">
  import { app } from '../state/app.svelte';
  import { MOMENT_MS, presenter } from './presenter.svelte';
  import {
    cardStep, cascadeCard, crossingSpeed, diePips, lavaBlob, metaballField, moveLavaBlob, streakSpawn,
    type CascadeCard,
  } from './momentMotion';

  /** Moments drawn on the canvas; every other moment is drawn in CSS. */
  const CANVAS_MOMENTS = new Set([
    'matrix-rain', 'starfield', 'confetti-storm', 'fireworks', 'bubbles', 'meteor-shower', 'petals',
    'lava-lamp', 'card-cascade', 'level-clear', 'constellation', 'fireflies',
  ]);
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

  /*
    The other way out: the beat stays owed, but waits in the mailbox instead
    of standing between a hurried reader and the task they came to add.
  */
  function laterStory() {
    app.deferStory();
    presenter.dismiss();
  }

  // On unlock display: confetti-adjacent celebration.
  $effect(() => {
    if (current?.kind === 'unlock') {
      burstAt(window.innerWidth / 2, 120, { count: 30, power: 1.2 });
      haptic('success');
    }
    // A celebrated note earns the same fanfare, thrown from the corner the
    // companion lives in so the eye lands on what actually changed.
    if (current?.kind === 'note' && current.celebrate) {
      burstAt(window.innerWidth - 40, window.innerHeight - 60, { count: 36, power: 1.5, upward: 260 });
      haptic('success');
    }
    if (current?.kind === 'moment') {
      haptic('tick');
      app.noteMomentShown(current.moment);
    }
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
        // Long enough to hold the longest word it listens for.
        wordBuf = (wordBuf + e.key.toLowerCase()).slice(-7);
        if (wordBuf.endsWith('chaos')) {
          wordBuf = '';
          app.grantUnlockAndShow('chaos-word');
          presenter.show({ kind: 'moment', moment: 'disco' });
        } else if (wordBuf.endsWith('entropy')) {
          // The other one's name, known only to readers of the story. A
          // phone types it into the search box instead (see SearchView).
          wordBuf = '';
          if (app.grantUnlockAndShow('named-it')) presenter.show({ kind: 'moment', moment: 'crt-flicker' });
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
    } else if (current.moment === 'fireworks') {
      // Shells launch, arc, and burst into the particle layer — the burst is
      // the app's own confetti, so the two effects share a look.
      let shells = 0;
      const launch = () => {
        const x = W * (0.2 + Math.random() * 0.6);
        const peak = H * (0.15 + Math.random() * 0.25);
        const start = performance.now();
        const rise = () => {
          const t = (performance.now() - start) / 700;
          if (t >= 1) {
            burstAt(x / (window.devicePixelRatio || 1), peak / (window.devicePixelRatio || 1),
              { count: 26, power: 1.5, ring: true, upward: 0 });
            return;
          }
          ctx.fillStyle = 'rgba(11,14,20,0.25)';
          ctx.fillRect(0, 0, W, H);
          ctx.fillStyle = '#ffd479';
          const y = H - (H - peak) * t;
          ctx.fillRect(x, y, 3, 8);
          requestAnimationFrame(rise);
        };
        rise();
      };
      launch();
      const interval = setInterval(() => {
        launch();
        if (++shells >= 4) clearInterval(interval);
      }, 520);
      return () => clearInterval(interval);
    } else if (current.moment === 'bubbles') {
      /*
        Quiet, not slow. The loud moments are loud and a calm one makes them
        land harder — but calm still has to finish: these used to start up to
        two screens BELOW the bottom and climb at 20–65 px/s, so most never
        appeared at all and the rest were halfway up when the moment ended
        (2026-09-21 report). They start spread across the screen now, and the
        speed is paced against the window rather than guessed in pixels.
      */
      const rise = crossingSpeed(H, MOMENT_MS, 1.4);
      const bubbles = Array.from({ length: 60 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 4 + Math.random() * 22,
        speed: rise * (0.75 + Math.random() * 0.5),
        drift: (Math.random() - 0.5) * 30,
      }));
      let last = performance.now();
      const draw = () => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        ctx.clearRect(0, 0, W, H);
        for (const b of bubbles) {
          b.y -= b.speed * dt;
          b.x += b.drift * dt;
          if (b.y + b.r < 0) { b.y = H + b.r; b.x = Math.random() * W; }
          ctx.beginPath();
          ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2);
          ctx.strokeStyle = 'rgba(121,192,255,0.55)';
          ctx.lineWidth = 1.5;
          ctx.stroke();
          ctx.fillStyle = 'rgba(121,192,255,0.07)';
          ctx.fill();
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
    } else if (current.moment === 'meteor-shower') {
      // Streaks cross the dark from upper right to lower left: a bright head
      // and a tail that fades along its own length, over a trailing fill so
      // each streak also leaves a brief afterglow. Spawning and speed are
      // screen-shape independent — see streakSpawn for what a narrow screen
      // does to a diagonal shower.
      const speed = crossingSpeed(H, MOMENT_MS, 6);
      const spawn = (seeding = false) => streakSpawn(W, H, speed, Math.random, seeding);
      const meteors = Array.from({ length: 16 }, () => spawn(true));
      let last = performance.now();
      const draw = () => {
        const now = performance.now();
        // Per elapsed time, not per frame: a 120Hz phone ran the same shower
        // at double speed.
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        ctx.fillStyle = 'rgba(11,14,20,0.28)';
        ctx.fillRect(0, 0, W, H);
        ctx.lineCap = 'round';
        ctx.lineWidth = 2;
        for (const m of meteors) {
          m.x += m.vx * dt;
          m.y += m.vy * dt;
          const k = Math.hypot(m.vx, m.vy);
          const tx = m.x - (m.vx / k) * m.len;
          const ty = m.y - (m.vy / k) * m.len;
          const tail = ctx.createLinearGradient(tx, ty, m.x, m.y);
          tail.addColorStop(0, 'rgba(255,214,121,0)');
          tail.addColorStop(1, 'rgba(255,244,214,0.95)');
          ctx.strokeStyle = tail;
          ctx.beginPath();
          ctx.moveTo(tx, ty);
          ctx.lineTo(m.x, m.y);
          ctx.stroke();
          if (m.y > H + m.len || m.x < -m.len) Object.assign(m, spawn());

        }
        raf = requestAnimationFrame(draw);
      };
      draw();
    } else if (current.moment === 'petals') {
      // The quiet one of its pair: petals fall and sway, nothing rushes —
      // but they still cross the screen inside the moment, and the sky is
      // full of them from the first frame (see bubbles, same 2026-09-21 fix).
      const fall = crossingSpeed(H, MOMENT_MS, 1.2);
      const petals = Array.from({ length: 70 }, () => ({
        x: Math.random() * W,
        y: Math.random() * H,
        r: 5 + Math.random() * 7,
        fall: fall * (0.75 + Math.random() * 0.5),
        sway: 0.8 + Math.random() * 1.6,
        phase: Math.random() * Math.PI * 2,
        spin: (Math.random() - 0.5) * 2,
        angle: Math.random() * Math.PI,
        tint: Math.random() < 0.7 ? 'rgba(247,120,186,0.75)' : 'rgba(255,214,228,0.8)',
      }));
      let last = performance.now();
      const draw = () => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        ctx.clearRect(0, 0, W, H);
        for (const p of petals) {
          p.y += p.fall * dt;
          p.phase += p.sway * dt;
          p.x += Math.sin(p.phase) * 22 * dt;
          p.angle += p.spin * dt;
          if (p.y - p.r > H) { p.y = -p.r; p.x = Math.random() * W; }
          ctx.save();
          ctx.translate(p.x, p.y);
          ctx.rotate(p.angle);
          ctx.beginPath();
          ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2);
          ctx.fillStyle = p.tint;
          ctx.fill();
          ctx.restore();
        }
        raf = requestAnimationFrame(draw);
      };
      draw();
    } else if (current.moment === 'card-cascade') {
      // The old desktop solitaire win: cards spring off the foundations,
      // bounce along the bottom and leave every frame behind them. Never
      // clearing is the whole effect — the overlay owns this canvas, so all
      // of it goes when the moment does.
      const cw = Math.max(34, Math.min(64, W * 0.11));
      const ch = cw * 1.4;
      const SUITS = ['♠', '♥', '♦', '♣'];
      const cards: CascadeCard[] = [];
      let launched = 0;
      let sinceLaunch = 1;
      let last = performance.now();
      const drawCard = (c: CascadeCard) => {
        ctx.fillStyle = '#f6f2e6';
        ctx.strokeStyle = '#141414';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (typeof ctx.roundRect === 'function') ctx.roundRect(c.x, c.y, c.w, c.h, 4);
        else ctx.rect(c.x, c.y, c.w, c.h);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = c.suit === '♥' || c.suit === '♦' ? '#c8102e' : '#141414';
        ctx.font = `${Math.round(c.h * 0.42)}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(c.suit, c.x + c.w / 2, c.y + c.h / 2);
      };
      const draw = () => {
        const now = performance.now();
        const dt = Math.min(0.05, (now - last) / 1000);
        last = now;
        sinceLaunch += dt;
        if (sinceLaunch > 0.45 && cards.filter((c) => c.alive).length < 3) {
          cards.push(cascadeCard(W, H, cw, ch, launched % 2 === 0, Math.random, SUITS[launched % 4]!));
          launched += 1;
          sinceLaunch = 0;
        }
        for (const c of cards) {
          if (!c.alive) continue;
          cardStep(c, dt, W, H);
          drawCard(c);
        }
        raf = requestAnimationFrame(draw);
      };
      draw();
    } else if (current.moment === 'lava-lamp') {
      // Real metaballs: blob fields summed on a coarse grid, every cell past
      // the threshold is wax. Computed small and scaled up with smoothing,
      // which is what softens the edges — and keeps it cheap on a phone.
      const cell = 4;
      const gw = Math.ceil(W / cell);
      const gh = Math.ceil(H / cell);
      const field = document.createElement('canvas');
      field.width = gw;
      field.height = gh;
      const fctx = field.getContext('2d');
      if (fctx) {
        const img = fctx.createImageData(gw, gh);
        const blobs = Array.from({ length: 8 }, (_, i) => lavaBlob(gw, gh, Math.random, i, 8));
        const t0 = performance.now();
        const draw = () => {
          const t = (performance.now() - t0) / 1000;
          for (const b of blobs) moveLavaBlob(b, t, gh);
          for (let y = 0; y < gh; y++) {
            const k = y / gh;
            for (let x = 0; x < gw; x++) {
              const v = metaballField(x, y, blobs);
              const i = (y * gw + x) * 4;
              // A soft step rather than a hard cut: the wax's edge fades over
              // a narrow band of the field, so scaled up it reads as a
              // rounded surface, not a staircase.
              const e = Math.min(1, Math.max(0, (v - 0.82) / 0.26));
              const wax = e * e * (3 - 2 * e);
              const halo = Math.max(0, Math.min(1, (v - 0.45) / 0.37)) * 0.35;
              img.data[i] = Math.round(120 + 135 * wax);
              img.data[i + 1] = Math.round(30 + (60 + 110 * (1 - k)) * wax);
              img.data[i + 2] = Math.round(70 + (110 * k - 20) * wax);
              img.data[i + 3] = Math.round(255 * Math.max(wax, halo));
            }
          }
          fctx.putImageData(img, 0, 0);
          ctx.clearRect(0, 0, W, H);
          // The lamp's heat: a warm glow pooling at the base.
          const heat = ctx.createRadialGradient(W / 2, H * 1.05, 0, W / 2, H * 1.05, H * 0.55);
          heat.addColorStop(0, 'rgba(255, 140, 60, 0.45)');
          heat.addColorStop(1, 'rgba(255, 140, 60, 0)');
          ctx.fillStyle = heat;
          ctx.fillRect(0, 0, W, H);
          ctx.imageSmoothingEnabled = true;
          ctx.drawImage(field, 0, 0, W, H);
          raf = requestAnimationFrame(draw);
        };
        draw();
      }
    } else if (current.moment === 'level-clear') {
      // An 8-bit stage clear, drawn at a quarter of the resolution and
      // scaled up without smoothing so every shape lands on chunky pixels.
      const px = 4;
      const lw = Math.ceil(W / px);
      const lh = Math.ceil(H / px);
      const low = document.createElement('canvas');
      low.width = lw;
      low.height = lh;
      const l = low.getContext('2d');
      if (l) {
        const COLORS = ['#ffd479', '#7ee787', '#79c0ff', '#f778ba', '#ffa657'];
        type Spark = { x: number; y: number; vx: number; vy: number; c: string };
        let sparks: Spark[] = [];
        let bursts = 0;
        const burst = () => {
          sparks = sparks.concat(Array.from({ length: 36 }, () => ({
            x: lw / 2 + (Math.random() - 0.5) * lw * 0.5, y: lh * 0.42,
            vx: (Math.random() - 0.5) * lw * 1.0, vy: -(0.25 + Math.random() * 0.7) * lh,
            c: COLORS[Math.floor(Math.random() * COLORS.length)]!,
          })));
          bursts += 1;
        };
        const t0 = performance.now();
        let last = t0;
        const draw = () => {
          const now = performance.now();
          const t = (now - t0) / 1000;
          const dt = Math.min(0.05, (now - last) / 1000);
          last = now;
          l.fillStyle = '#0b0e14';
          l.fillRect(0, 0, lw, lh);
          // The banner drops in and settles with a couple of bounces.
          const p = Math.min(1, t / 0.7);
          const y = lh * 0.42 * (1 - Math.abs(Math.cos(p * Math.PI * 2.5)) * (1 - p));
          l.fillStyle = Math.floor(t * 6) % 2 ? '#ffd479' : '#ffffff';
          l.font = `bold ${Math.max(8, Math.round(lw / 9))}px monospace`;
          l.textAlign = 'center';
          l.textBaseline = 'middle';
          l.fillText('LEVEL CLEAR!', lw / 2, y);
          if (t > 0.7) {
            // A fresh burst each time the banner flashes, like a fanfare.
            if (bursts < 1 + Math.floor((t - 0.7) / 1.3)) burst();
            l.fillStyle = Math.floor(t * 3) % 2 ? '#7ee787' : '#79c0ff';
            l.font = `bold ${Math.max(6, Math.round(lw / 16))}px monospace`;
            l.fillText('SCORE +1000', lw / 2, lh * 0.5);
            for (const s of sparks) {
              s.vy += lh * 0.8 * dt;
              s.x += s.vx * dt;
              s.y += s.vy * dt;
              l.fillStyle = s.c;
              l.fillRect(Math.round(s.x), Math.round(s.y), 2, 2);
            }
            sparks = sparks.filter((s) => s.y < lh + 4);
          }
          ctx.imageSmoothingEnabled = false;
          ctx.clearRect(0, 0, W, H);
          ctx.drawImage(low, 0, 0, W, H);
          raf = requestAnimationFrame(draw);
        };
        draw();
      }
    } else if (current.moment === 'constellation') {
      // Stars come out, a few brighten, and lines join them into the face of
      // a die — the app's own symbol, written across the night.
      const face = 1 + Math.floor(Math.random() * 6);
      const side = Math.min(W, H) * 0.42;
      const ox = (W - side) / 2;
      const oy = (H - side) / 2;
      const pips = diePips(face).map(([x, y]) => [ox + x * side, oy + y * side] as const);
      const field = Array.from({ length: 140 }, () => ({
        x: Math.random() * W, y: Math.random() * H, r: 0.6 + Math.random() * 1.3, p: Math.random() * 6,
      }));
      const t0 = performance.now();
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        ctx.clearRect(0, 0, W, H);
        for (const s of field) {
          ctx.globalAlpha = 0.35 + 0.35 * Math.sin(t * 2 + s.p);
          ctx.fillStyle = '#c9d1d9';
          ctx.fillRect(s.x, s.y, s.r, s.r);
        }
        ctx.globalAlpha = 1;
        const bright = Math.min(1, t / 1.2);
        ctx.fillStyle = `rgba(255, 244, 214, ${bright})`;
        for (const [x, y] of pips) {
          ctx.beginPath();
          ctx.arc(x, y, 3.2, 0, Math.PI * 2);
          ctx.fill();
        }
        // Lines between pips, then the outline of the die, drawn on in turn.
        const drawn = Math.max(0, (t - 1.2) / 2.2);
        ctx.strokeStyle = 'rgba(121, 192, 255, 0.75)';
        ctx.lineWidth = 1.2;
        ctx.beginPath();
        for (let i = 1; i < pips.length && i <= drawn * pips.length; i++) {
          ctx.moveTo(pips[i - 1]![0], pips[i - 1]![1]);
          ctx.lineTo(pips[i]![0], pips[i]![1]);
        }
        ctx.stroke();
        const outline = Math.max(0, Math.min(1, (t - 3.4) / 1.4));
        if (outline > 0) {
          ctx.strokeStyle = `rgba(210, 168, 255, ${0.8 * outline})`;
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          if (typeof ctx.roundRect === 'function') ctx.roundRect(ox, oy, side, side, side * 0.12);
          else ctx.rect(ox, oy, side, side);
          ctx.stroke();
        }
        raf = requestAnimationFrame(draw);
      };
      draw();
    } else if (current.moment === 'fireflies') {
      // A summer field at dusk: soft lights drift and blink on and off. Each
      // glow is drawn as a gradient, never a filter, so nothing here asks
      // the compositor to blur a repainting layer.
      const flies = Array.from({ length: 42 }, () => ({
        x: Math.random() * W, y: Math.random() * H,
        p: Math.random() * Math.PI * 2, rate: 0.6 + Math.random() * 1.1,
        dx: (Math.random() - 0.5) * 0.6, dy: (Math.random() - 0.5) * 0.6,
      }));
      const t0 = performance.now();
      const draw = () => {
        const t = (performance.now() - t0) / 1000;
        ctx.clearRect(0, 0, W, H);
        for (const f of flies) {
          const x = f.x + Math.sin(t * 0.5 + f.p) * W * 0.04 + f.dx * t * 12;
          const y = f.y + Math.cos(t * 0.4 + f.p) * H * 0.03 + f.dy * t * 12;
          const glow = Math.max(0, Math.sin(t * f.rate + f.p)) ** 3;
          if (glow < 0.02) continue;
          const g = ctx.createRadialGradient(x, y, 0, x, y, 14);
          g.addColorStop(0, `rgba(228, 255, 150, ${0.95 * glow})`);
          g.addColorStop(0.35, `rgba(180, 230, 90, ${0.45 * glow})`);
          g.addColorStop(1, 'rgba(180, 230, 90, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(x - 14, y - 14, 28, 28);
        }
        raf = requestAnimationFrame(draw);
      };
      draw();
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
          <button class="xp-later" data-testid="delight-story-later" onclick={laterStory}>later</button>
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
    <!-- A div, not a button: see the .moment rule for why the element type
         matters to how far it reaches. -->
    <div class="moment m-{current.moment}" data-testid="delight-moment" role="button" tabindex="0"
      aria-label="dismiss" onclick={() => presenter.dismiss()}
      onkeydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); presenter.dismiss(); } }}>
      {#if CANVAS_MOMENTS.has(current.moment)}
        <canvas bind:this={canvasEl}></canvas>
      {:else if current.moment === 'power-off'}
        <!-- An old monitor switching off: the picture folds to a line, the
             line to a dot, and then the famous all-clear. -->
        <div class="crt-off" aria-hidden="true"></div>
        <p class="crt-safe">It is now safe to turn off your task.</p>
      {:else if current.moment === 'ticker-tape'}
        <div class="ticker">
          <span>&nbsp;★&nbsp;ANOTHER ONE DONE&nbsp;★&nbsp;THE LIST GROWS SHORTER&nbsp;★&nbsp;WITNESSED AND RECORDED&nbsp;★&nbsp;ANOTHER ONE DONE&nbsp;★&nbsp;THE LIST GROWS SHORTER&nbsp;★&nbsp;WITNESSED AND RECORDED&nbsp;★&nbsp;</span>
        </div>
      {:else if current.moment === 'friendly-bsod'}
        <div class="bsod">
          <p class="bsod-face">:)</p>
          <p>Your productivity ran into a task and finished it.</p>
          <p class="bsod-sub">100% complete. This was not an error. Tap to continue being great.</p>
        </div>
      {/if}
    </div>
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
  .accent-yellow { border-color: var(--acc-yellow); }
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
  .xp-later {
    padding: 6px 12px; cursor: pointer;
    background: none; border: 1px solid rgb(126 231 135 / 0.35); border-radius: 3px;
    color: rgb(126 231 135 / 0.8); font-family: var(--font-mono); font-size: 0.78rem;
  }
  @media (hover: hover) { .xp-later:hover { border-color: var(--acc-green); color: var(--acc-green); } }
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

  /*
    Sized by its insets alone, and a plain div, like the story and quiz
    backdrops that reach every edge of an installed iPhone app. Two traps
    sit either side of that. A viewport-unit height is short there: 100vh
    measures the screen minus the home-indicator strip, so a layer sized
    by it ends in a hard edge above the bottom (2026-09-29 report). And a
    <button> is a form control, which iOS may size to its content rather
    than stretch between its insets. Neither emulated engine shows either,
    so the layout guard in registry.test pins the recipe itself.
  */
  .moment {
    position: fixed; inset: 0; z-index: 400;
    cursor: pointer;
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
  .m-fireworks, .m-bubbles { background: rgba(11, 14, 20, 0.82); }
  .m-meteor-shower { background: rgba(11, 14, 20, 0.92); }
  .m-petals { background: rgba(11, 14, 20, 0.55); }
  /* A storm in three flashes: the sky lights, holds a beat, lights again.
     Loud on purpose; the lava lamp below is its quiet counterpart. Only the
     colour animates — no filters, nothing that repaints underneath. */
  .m-lightning {
    background: rgba(11, 14, 20, 0.7);
    animation: lightning 1.7s ease-out 3;
  }
  @keyframes lightning {
    0%, 18%, 40%, 100% { background: rgba(11, 14, 20, 0.7); }
    4%, 24% { background: rgba(232, 240, 255, 0.92); }
    8% { background: rgba(121, 192, 255, 0.35); }
    30% { background: rgba(232, 240, 255, 0.6); }
  }
  /* The lamp's fluid; the wax itself is drawn on the canvas. */
  .m-lava-lamp { background: rgb(24, 8, 22); }
  /* The felt every solitaire win was played on. */
  .m-card-cascade { background: rgb(14, 96, 44); }
  .m-level-clear { background: #0b0e14; }
  .m-constellation { background: rgb(6, 9, 18); }
  .m-fireflies { background: rgba(8, 16, 10, 0.9); }
  .m-power-off { background: #030405; display: grid; place-items: center; }
  .crt-off {
    position: absolute; inset: 0; background: #eaf4ff;
    box-shadow: 0 0 60px rgba(159, 211, 255, 0.9);
    transform-origin: center;
    animation: crt-off 1.1s ease-in forwards;
  }
  @keyframes crt-off {
    0% { transform: scale(1, 1); opacity: 0.85; }
    45% { transform: scale(1, 0.006); opacity: 1; }
    75% { transform: scale(0.004, 0.006); opacity: 1; }
    100% { transform: scale(0, 0); opacity: 0; }
  }
  .crt-safe {
    position: relative; margin: 0; padding: 0 24px; text-align: center;
    color: #f0a020; font-family: var(--font-mono); font-size: 1rem;
    opacity: 0; animation: crt-safe 0.4s ease-out 1.5s forwards;
  }
  @keyframes crt-safe { to { opacity: 1; } }
  /* A dawn that arrives in two seconds: the warm band climbs and the dark
     lifts off it. The quiet counterpart to the loud ones. */
  .m-sunrise {
    background:
      radial-gradient(120% 80% at 50% 120%, rgba(255, 214, 121, 0.55), transparent 62%),
      radial-gradient(150% 90% at 50% 130%, rgba(247, 120, 186, 0.35), transparent 68%),
      linear-gradient(180deg, rgba(11, 14, 20, 0.85), rgba(11, 14, 20, 0.25));
    animation: sunrise-climb 2.4s ease-out forwards;
  }
  @keyframes sunrise-climb {
    from { background-position: 0 40%, 0 40%, 0 0; opacity: 0.2; }
    to { background-position: 0 0%, 0 0%, 0 0; opacity: 1; }
  }
  .m-ticker-tape { background: rgba(11, 14, 20, 0.88); display: grid; place-items: center; overflow: hidden; }
  .ticker {
    width: 100%; white-space: nowrap; overflow: hidden;
    border-top: 2px solid var(--acc-green); border-bottom: 2px solid var(--acc-green);
    background: #06120a; padding: 14px 0;
  }
  .ticker span {
    display: inline-block; color: var(--acc-green);
    font-family: var(--font-mono); font-size: 1.4rem; letter-spacing: 0.12em;
    animation: ticker-run 6s linear infinite;
  }
  @keyframes ticker-run { to { transform: translateX(-50%); } }
  @media (prefers-reduced-motion: reduce) {
    .ticker span, .m-sunrise, .m-lightning, .crt-off, .crt-safe { animation: none; }
  }
  .m-friendly-bsod { background: #1533b8; display: grid; place-items: center; }
  .bsod { color: #fff; font-family: var(--font-mono); text-align: left; max-width: 420px; padding: 20px; }
  .bsod-face { font-size: 4rem; margin: 0 0 12px; }
  .bsod p { margin: 4px 0; }
  .bsod-sub { opacity: 0.75; font-size: 0.8rem; }
</style>
