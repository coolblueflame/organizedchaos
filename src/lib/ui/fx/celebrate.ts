/**
 * Completion celebrations (2026-07-28 request: "some variety in the confetti").
 *
 * Every finished task used to throw the identical burst, which stops
 * registering after the first day. Three things vary now:
 *
 *  - the texture, drawn at random from several distinct looks, so consecutive
 *    completions rarely feel like reruns;
 *  - the SIZE, which climbs as the day's count does — the tenth thing you tick
 *    off should land harder than the first;
 *  - and rarely, something considerably louder.
 *
 * All of it is garnish: every function here is safe to call, does nothing under
 * reduced-motion (burstAt bails), and callers already wrap these in try/catch so
 * a failure can never block the completion itself.
 */
import { burstAt, type BurstOptions } from './particles';

const ACCENT_SETS: string[][] = [
  ['#7ee787', '#56d4dd', '#e3b341'],
  ['#79c0ff', '#d2a8ff', '#56d4dd'],
  ['#ffa657', '#e3b341', '#f778ba'],
  ['#7ee787', '#79c0ff', '#d2a8ff', '#ffa657'],
];

/** The distinct looks a routine completion can take. */
const TEXTURES: BurstOptions[] = [
  { count: 16, power: 1.0 },                                        // the classic
  { count: 30, power: 1.25, sizeScale: 0.6, shape: 'dot' },         // fine spray
  { count: 10, power: 0.85, sizeScale: 1.7, lifeScale: 1.5 },       // slow drifting flakes
  { count: 18, power: 1.15, ring: true, upward: 40 },               // an even ring
  { count: 14, power: 1.5, upward: 320, sizeScale: 1.1 },           // fountain upward
];

const pickOne = <T>(arr: readonly T[], rng: () => number): T =>
  arr[Math.floor(rng() * arr.length)]!;

/**
 * How much louder the burst should be for the Nth completion of the day.
 * Deliberately gentle and capped — this is a nudge, not an escalation.
 */
function dayScale(completionsToday: number): number {
  if (completionsToday >= 20) return 1.9;
  if (completionsToday >= 10) return 1.55;
  if (completionsToday >= 5) return 1.3;
  return 1;
}

/** The rare one. Kept vague on purpose — it should be a surprise, not a menu item. */
function fanfare(x: number, y: number, rng: () => number): void {
  const colors = ACCENT_SETS[3]!;
  burstAt(x, y, { count: 60, power: 2.1, sizeScale: 1.4, lifeScale: 1.6, colors });
  burstAt(x, y, { count: 28, power: 1.2, ring: true, upward: 60, colors });
  // A few off-centre volleys so it reads as an event rather than a bigger burst.
  const w = typeof window === 'undefined' ? 360 : window.innerWidth;
  const h = typeof window === 'undefined' ? 640 : window.innerHeight;
  for (let i = 0; i < 4; i += 1) {
    const px = w * (0.15 + rng() * 0.7);
    const py = h * (0.2 + rng() * 0.5);
    setTimeout(
      () => burstAt(px, py, { count: 22, power: 1.6, sizeScale: 1.2, lifeScale: 1.4, colors }),
      120 + i * 130,
    );
  }
}

export interface CelebrateOptions {
  /** Drives the size ramp; pass the app-day's completion count. */
  completionsToday?: number;
  /** Louder baseline for the current-task card, which is the app's big moment. */
  emphatic?: boolean;
  rng?: () => number;
}

/** Odds of the rare one, per completion. */
const FANFARE_CHANCE = 0.01;

/** Celebrate a completion at a point on screen. Never throws on its own. */
export function celebrateCompletion(x: number, y: number, opts: CelebrateOptions = {}): void {
  const { completionsToday = 0, emphatic = false, rng = Math.random } = opts;

  if (rng() < FANFARE_CHANCE) {
    fanfare(x, y, rng);
    return;
  }

  const texture = pickOne(TEXTURES, rng);
  const scale = dayScale(completionsToday) * (emphatic ? 1.45 : 1);
  burstAt(x, y, {
    ...texture,
    colors: pickOne(ACCENT_SETS, rng),
    count: Math.round((texture.count ?? 14) * Math.min(scale, 1.8)),
    power: (texture.power ?? 1) * (emphatic ? 1.2 : 1),
    sizeScale: (texture.sizeScale ?? 1) * (scale > 1.4 ? 1.2 : 1),
  });
}

/** Convenience for the common case: celebrate from an element's centre. */
export function celebrateFromElement(el: Element, opts: CelebrateOptions = {}): void {
  const r = el.getBoundingClientRect();
  celebrateCompletion(r.left + r.width / 2, r.top + r.height / 2, opts);
}
