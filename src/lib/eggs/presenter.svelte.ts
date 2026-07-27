/**
 * Presentation state for the delight layer. One presentation at a time; the
 * DelightLayer component renders it. Hard caps (spec §12) enforced here:
 * notes autodismiss, moments are time-boxed, everything closes on one tap.
 */
import type { Presentation } from './engine';
import { motionOk } from '../ui/fx/particles';

/** Awards waiting their turn; small on purpose — see queue handling below. */
const QUEUE_MAX = 3;

class PresenterStore {
  current: Presentation | null = $state(null);
  private timer: ReturnType<typeof setTimeout> | undefined;
  private queue: Presentation[] = [];

  show(p: Presentation): void {
    // Visual moments are pure motion — skip entirely under reduced-motion.
    if (p.kind === 'moment' && !motionOk()) return;

    if (this.current) {
      // Earned awards are never silently replaced: a sweep that crosses two
      // milestones at once must show both, not flash one for a frame. They
      // queue instead, and a waiting queue shortens each turn so the whole
      // run still clears in a few seconds (spec §12: never block the user).
      if (p.kind === 'unlock') {
        const dupe = this.queue.some((q) => q.kind === 'unlock' && q.unlockId === p.unlockId);
        if (!dupe && this.queue.length < QUEUE_MAX) this.queue.push(p);
        return;
      }
      // Ambient content yields to anything the user has to acknowledge.
      if (this.current.kind !== 'note' && this.current.kind !== 'moment') return;
    }
    this.present(p);
  }

  private present(p: Presentation): void {
    clearTimeout(this.timer);
    this.current = p;
    const waiting = this.queue.length > 0;
    const ttl = p.kind === 'note' ? 7000
      : p.kind === 'moment' ? 3500
      : p.kind === 'unlock' ? (waiting ? 2600 : 6000)
      : null; // trivia + story wait for the user (still one-tap dismissable)
    if (ttl) this.timer = setTimeout(() => this.dismiss(), ttl);
  }

  dismiss(): void {
    clearTimeout(this.timer);
    const next = this.queue.shift();
    if (next) {
      this.current = null; // let the layer transition out before the next one
      setTimeout(() => this.present(next), 260);
      return;
    }
    this.current = null;
  }
}

export const presenter = new PresenterStore();
