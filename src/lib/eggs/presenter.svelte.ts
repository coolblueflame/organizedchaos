/**
 * Presentation state for the delight layer. One presentation at a time; the
 * DelightLayer component renders it. Hard caps (spec §12) enforced here:
 * notes autodismiss, moments are time-boxed, everything closes on one tap.
 */
import type { Presentation } from './engine';
import { motionOk } from '../ui/fx/particles';

/** Awards waiting their turn; small on purpose — see queue handling below. */
const QUEUE_MAX = 3;
/** Gap between one presentation leaving and the next arriving. */
const HANDOFF_MS = 260;
/**
 * Anything with words in it stays until the reader is done with it, because a
 * countdown is the wrong model: it ran out while the app was BACKGROUNDED once,
 * so reopening the app to read the thing showed an empty screen (reported
 * 2026-07-28). Only motion is still time-boxed — there is nothing to read.
 */
const MOMENT_MS = 3500;
/**
 * …but it cannot be dismissed instantly either: whatever tap or scroll was
 * already in flight when it appeared would wipe it before it was read. A short
 * protected window absorbs that.
 */
const MIN_VISIBLE_MS = 3000;

export class PresenterStore {
  current: Presentation | null = $state(null);
  /** Holds whichever timer is pending — a lifetime OR a hand-off, never both. */
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Presentation[] = [];
  /** True while an award is crossing the gap between two presentations. */
  private handingOff = false;
  private shownAt = 0;

  show(p: Presentation): void {
    // Visual moments are pure motion — skip entirely under reduced-motion.
    if (p.kind === 'moment' && !motionOk()) return;
    const busy = this.current !== null || this.handingOff;

    if (busy) {
      // Earned awards are never silently replaced: a sweep that crosses two
      // milestones at once must show both, not flash one for a frame (spec §12
      // still applies — the run has to clear in seconds, hence the shortening).
      if (p.kind === 'unlock') {
        const dupe = this.queue.some((q) => q.kind === 'unlock' && q.unlockId === p.unlockId);
        if (!dupe && this.queue.length < QUEUE_MAX) this.queue.push(p);
        return;
      }
      // Ambient content yields to anything the user has to acknowledge — and
      // must not seize the empty slot an award is already crossing.
      if (this.handingOff) return;
      if (this.current!.kind !== 'note' && this.current!.kind !== 'moment') return;
    }
    this.present(p);
  }

  private present(p: Presentation): void {
    clearTimeout(this.timer);
    this.handingOff = false;
    this.current = p;
    this.shownAt = Date.now();
    // Motion is the only thing that expires on its own; everything else waits
    // to be read and dismissed.
    if (p.kind === 'moment') this.timer = setTimeout(() => this.clear(), MOMENT_MS);
  }

  /** True once the protected window has passed. */
  get settled(): boolean {
    return this.current === null || Date.now() - this.shownAt >= MIN_VISIBLE_MS;
  }

  /**
   * Deliberate dismissal — the user tapped the thing itself or its close
   * button. Always honoured: if you aimed at it, you meant it.
   */
  dismiss(): void {
    this.clear();
  }

  /**
   * Incidental dismissal, from interacting with the app elsewhere. Ignored
   * inside the protected window, because the tap that gets swallowed there is
   * usually one that was already in flight when the thing appeared.
   */
  dismissAway(): void {
    if (this.settled) this.clear();
  }

  private clear(): void {
    clearTimeout(this.timer);
    this.current = null;
    if (this.queue.length === 0) {
      this.handingOff = false;
      return;
    }
    // Peek rather than shift: a second dismiss inside the hand-off window has
    // to cancel and re-arm the SAME hand-off. Taking the award off the queue
    // here meant the cancelled timer took it with it, and the user never saw
    // an award they had genuinely earned.
    this.handingOff = true;
    this.timer = setTimeout(() => {
      const next = this.queue.shift();
      if (next) this.present(next);
      else this.handingOff = false;
    }, HANDOFF_MS);
  }
}

export const presenter = new PresenterStore();
