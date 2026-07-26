/**
 * One facade for "make the phone thump" (spec §7).
 *
 * Android / Chromium: the real Vibration API.
 * iOS Safari: no vibrate API. EXPERIMENT (spec §2 assumption 3): toggling a
 * native `<input type="checkbox" switch>` inside a user-gesture call stack has
 * been reported to fire the system switch haptic on iOS 17.4+. FxLayer hosts a
 * hidden switch; we click it and hope. If it's dead on Ben's device, this
 * degrades to silence — update this comment with the on-device verdict.
 */

let iosSwitch: HTMLInputElement | null = null;

export function bindIosSwitch(el: HTMLInputElement): void {
  iosSwitch = el;
}

const isIos = typeof navigator !== 'undefined' &&
  (/iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

const PATTERNS: Record<'tick' | 'success' | 'heavy', number | number[]> = {
  tick: 8,
  success: [10, 40, 14],
  heavy: 25,
};

export function haptic(kind: 'tick' | 'success' | 'heavy'): void {
  try {
    if (isIos) {
      iosSwitch?.click(); // best-effort switch-toggle haptic
      return;
    }
    navigator.vibrate?.(PATTERNS[kind]);
  } catch {
    // Haptics are garnish — never let them break a flow.
  }
}
