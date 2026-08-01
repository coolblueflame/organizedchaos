/**
 * "Is the on-screen keyboard up?" — visualViewport shrinks when it opens, the
 * layout viewport doesn't. Used to HIDE floating buttons instead of letting
 * the browser scoot them up over the text being typed (2026-08-01 ask).
 * Desktop (no visualViewport or no meaningful shrink) always reads false.
 */
class KeyboardOpen {
  open = $state(false);

  constructor() {
    if (typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const measure = () => {
      // 0.75: keyboards eat well over a quarter of a phone screen; browser
      // chrome changes (URL bar collapse) stay well under it.
      this.open = vv.height < window.innerHeight * 0.75;
    };
    vv.addEventListener('resize', measure);
    measure();
  }
}

export const keyboard = new KeyboardOpen();
