/**
 * Slot-machine text reveal (spec §7): scrambled frames that progressively
 * settle left-to-right into the final text. Timing is injectable so tests run
 * synchronously; reduced-motion short-circuits straight to the final text.
 */
import { motionOk } from './particles';

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789#$%&?!▓░';

export interface ShuffleOptions {
  frames?: number;
  intervalMs?: number;
  /** Test seam — defaults to setTimeout. */
  schedule?: (fn: () => void, ms: number) => void;
  /** Test seam — defaults to Math.random. */
  rng?: () => number;
}

export function shuffleReveal(
  final: string,
  onFrame: (text: string, done: boolean) => void,
  opts: ShuffleOptions = {},
): void {
  if (!motionOk() || final.length === 0) {
    onFrame(final, true);
    return;
  }
  const { frames = 9, intervalMs = 50 } = opts;
  const schedule = opts.schedule ?? ((fn, ms) => void setTimeout(fn, ms));
  const rng = opts.rng ?? Math.random;
  let i = 0;
  const tick = () => {
    if (i >= frames) {
      onFrame(final, true);
      return;
    }
    const settled = Math.floor((i / frames) * final.length);
    let out = final.slice(0, settled);
    for (let j = settled; j < final.length; j++) {
      const ch = final[j]!;
      out += ch === ' ' ? ' ' : CHARS[Math.floor(rng() * CHARS.length)]!;
    }
    onFrame(out, false);
    i += 1;
    schedule(tick, intervalMs);
  };
  tick();
}
