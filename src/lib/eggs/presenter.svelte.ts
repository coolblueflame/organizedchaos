/**
 * Presentation state for the delight layer. One presentation at a time; the
 * DelightLayer component renders it. Hard caps (spec §12) enforced here:
 * notes autodismiss, moments are time-boxed, everything closes on one tap.
 */
import type { Presentation } from './engine';
import { motionOk } from '../ui/fx/particles';

class PresenterStore {
  current: Presentation | null = $state(null);
  private timer: ReturnType<typeof setTimeout> | undefined;

  show(p: Presentation): void {
    // Visual moments are pure motion — skip entirely under reduced-motion.
    if (p.kind === 'moment' && !motionOk()) return;
    clearTimeout(this.timer);
    this.current = p;
    const ttl = p.kind === 'note' ? 7000
      : p.kind === 'moment' ? 3500
      : p.kind === 'unlock' ? 6000
      : null; // trivia + story wait for the user (still one-tap dismissable)
    if (ttl) this.timer = setTimeout(() => this.dismiss(), ttl);
  }

  dismiss(): void {
    clearTimeout(this.timer);
    this.current = null;
  }
}

export const presenter = new PresenterStore();
