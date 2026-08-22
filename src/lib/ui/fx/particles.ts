/**
 * Tiny zero-dependency particle engine for the juice layer (spec §7).
 * One fixed canvas (FxLayer) renders a pooled particle set; the RAF loop runs
 * only while particles are alive, so the layer costs nothing at idle.
 * Under prefers-reduced-motion every spawn is a silent no-op.
 */

export interface Particle {
  x: number; y: number;
  vx: number; vy: number;
  life: number;          // 1 → 0
  decay: number;         // life lost per second
  size: number;
  color: string;
  rot: number;
  spin: number;          // radians/sec
  shape: 'square' | 'dot';
}

/** Integration constants — tuned for "confetti with a bit of weight". */
const GRAVITY = 900;   // px/s²
const DRAG = 0.985;    // per-frame velocity retention at 60fps

/** Pure step so the math is unit-testable; dt in seconds. Returns false when dead. */
export function stepParticle(p: Particle, dt: number): boolean {
  p.vy += GRAVITY * dt;
  const drag = Math.pow(DRAG, dt * 60);
  p.vx *= drag;
  p.vy *= drag;
  p.x += p.vx * dt;
  p.y += p.vy * dt;
  p.rot += p.spin * dt;
  p.life -= p.decay * dt;
  return p.life > 0;
}

const ACCENTS = ['#79c0ff', '#d2a8ff', '#7ee787', '#ffa657', '#56d4dd', '#f778ba', '#e3b341'];
const MAX_PARTICLES = 300;

let pool: Particle[] = [];
let canvas: HTMLCanvasElement | null = null;
let ctx: CanvasRenderingContext2D | null = null;
let rafId = 0;
let lastTs = 0;

/*
  Test seam, same idea as clock.svelte's __ocTickClock: particles live in a
  module-private pool drawn to one shared canvas, so "did that click
  celebrate?" is otherwise unobservable from the DOM. Counts bursts over the
  page's LIFETIME, not live particles: a check running after the confetti has
  faded would otherwise read zero and call a real celebration missing.
*/
let lifetimeBursts = 0;
if (typeof window !== 'undefined') {
  (window as unknown as { __ocBurstsEmitted?: () => number }).__ocBurstsEmitted =
    () => lifetimeBursts;
}

let reduced = false;
if (typeof window !== 'undefined' && 'matchMedia' in window) {
  const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  reduced = mq.matches;
  mq.addEventListener?.('change', (e) => (reduced = e.matches));
}

/** False when the user asked for reduced motion — callers skip embellishments. */
export function motionOk(): boolean {
  return !reduced;
}

function resize() {
  if (!canvas || !ctx) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = window.innerWidth * dpr;
  canvas.height = window.innerHeight * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

/** FxLayer calls this once with its canvas; returns an unbind cleanup. */
export function bindCanvas(el: HTMLCanvasElement): () => void {
  canvas = el;
  ctx = el.getContext('2d');
  resize();
  window.addEventListener('resize', resize);
  return () => {
    window.removeEventListener('resize', resize);
    cancelAnimationFrame(rafId);
    rafId = 0;
    pool = [];
    canvas = null;
    ctx = null;
  };
}

function frame(ts: number) {
  if (!ctx || !canvas) return;
  const dt = Math.min(0.05, (ts - lastTs) / 1000 || 0.016);
  lastTs = ts;
  ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  pool = pool.filter((p) => stepParticle(p, dt));
  for (const p of pool) {
    ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
    ctx.fillStyle = p.color;
    if (p.shape === 'dot') {
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size / 2, 0, Math.PI * 2);
      ctx.fill();
    } else {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
  if (pool.length > 0) {
    rafId = requestAnimationFrame(frame);
  } else {
    rafId = 0;
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
  }
}

function ensureLoop() {
  if (rafId === 0 && pool.length > 0) {
    lastTs = performance.now();
    rafId = requestAnimationFrame(frame);
  }
}

export interface BurstOptions {
  count?: number;
  colors?: string[];
  power?: number;      // initial speed scale
  /** Scales particle size — bigger reads as heavier, more celebratory. */
  sizeScale?: number;
  /** >1 makes particles hang around longer (divides the decay rate). */
  lifeScale?: number;
  /** Evenly space the angles instead of randomising, for a clean ring. */
  ring?: boolean;
  /** Upward bias applied on top of the radial velocity; defaults to 150. */
  upward?: number;
  /** Force a shape instead of the usual mix. */
  shape?: 'dot' | 'square';
}

export function burstAt(x: number, y: number, opts: BurstOptions = {}): void {
  if (reduced || !ctx) return;
  const {
    count = 14, colors = ACCENTS, power = 1,
    sizeScale = 1, lifeScale = 1, ring = false, upward = 150, shape,
  } = opts;
  lifetimeBursts += 1; // one burst = one countable celebration (see the seam)
  for (let i = 0; i < count && pool.length < MAX_PARTICLES; i++) {
    // A ring wants even spacing; everything else looks better scattered.
    const angle = ring
      ? (i / count) * Math.PI * 2
      : Math.random() * Math.PI * 2;
    const speed = (120 + (ring ? 130 : Math.random() * 260)) * power;
    pool.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - upward * power, // bias upward — feels celebratory
      life: 1,
      decay: (1.1 + Math.random() * 0.8) / lifeScale,
      size: (3 + Math.random() * 5) * sizeScale,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - 0.5) * 12,
      shape: shape ?? (Math.random() < 0.35 ? 'dot' : 'square'),
    });
  }
  ensureLoop();
}

/** Bigger celebratory preset for completing the current task. */
export function confettiAt(x: number, y: number): void {
  burstAt(x, y, { count: 42, power: 1.6 });
}

/** Convenience: burst from an element's center. */
export function burstFromElement(el: Element, opts: BurstOptions = {}): void {
  const r = el.getBoundingClientRect();
  burstAt(r.left + r.width / 2, r.top + r.height / 2, opts);
}
