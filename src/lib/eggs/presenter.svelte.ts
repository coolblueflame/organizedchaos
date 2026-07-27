/**
 * Presentation state for the delight layer. One presentation at a time; the
 * DelightLayer component renders it. Hard caps (spec §12) enforced here:
 * notes autodismiss, moments are time-boxed, everything closes on one tap.
 */
import type { Presentation } from './engine';
import { motionOk } from '../ui/fx/particles';

/** Awards waiting their turn; small on purpose — see queue handling below. */
const QUEUE_MAX = 3;
const AWARD_MS = 6000;
/** A shorter turn once others are waiting, so a run of awards still clears fast. */
const AWARD_QUEUED_MS = 2600;
/** Gap between one presentation leaving and the next arriving. */
const HANDOFF_MS = 260;

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
        if (!dupe && this.queue.length < QUEUE_MAX) {
          this.queue.push(p);
          this.hurryCurrentAward();
        }
        return;
      }
      // Ambient content yields to anything the user has to acknowledge — and
      // must not seize the empty slot an award is already crossing.
      if (this.handingOff) return;
      if (this.current!.kind !== 'note' && this.current!.kind !== 'moment') return;
    }
    this.present(p);
  }

  /**
   * An award already on screen when another is earned keeps its original,
   * longer turn — so the shortening never reached the first award, which is
   * exactly the case where two are earned together. Re-arm it, but only ever
   * downwards: an award that has already had its shortened time goes now.
   */
  private hurryCurrentAward(): void {
    if (this.current?.kind !== 'unlock') return;
    const remaining = Math.max(0, AWARD_QUEUED_MS - (Date.now() - this.shownAt));
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.dismiss(), remaining);
  }

  private present(p: Presentation): void {
    clearTimeout(this.timer);
    this.handingOff = false;
    this.current = p;
    this.shownAt = Date.now();
    const waiting = this.queue.length > 0;
    const ttl = p.kind === 'note' ? 7000
      : p.kind === 'moment' ? 3500
      : p.kind === 'unlock' ? (waiting ? AWARD_QUEUED_MS : AWARD_MS)
      : null; // trivia + story wait for the user (still one-tap dismissable)
    if (ttl) this.timer = setTimeout(() => this.dismiss(), ttl);
  }

  dismiss(): void {
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
