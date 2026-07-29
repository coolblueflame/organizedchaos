/**
 * Carrying the iOS keyboard across a navigation.
 *
 * iOS opens the software keyboard only when focus() runs inside a user
 * gesture's own event turn. Tapping the home search bar navigates, the search
 * screen mounts, and ITS autofocus runs a task later — focused field, no
 * keyboard, second tap required (reported 2026-07-29).
 *
 * The bridge: inside the tap handler, focus a hidden input — that consumes the
 * gesture and summons the keyboard legitimately. After navigation, the real
 * field ADOPTS the focus; moving focus between text inputs while the keyboard
 * is up does not dismiss it. The bridge input removes itself either way.
 */

const BRIDGE_ID = 'kb-bridge';

/** Call synchronously inside the tap handler, before navigating. */
export function primeKeyboard(): void {
  let el = document.getElementById(BRIDGE_ID) as HTMLInputElement | null;
  if (!el) {
    el = document.createElement('input');
    el.id = BRIDGE_ID;
    el.type = 'text';
    el.setAttribute('aria-hidden', 'true');
    // Offscreen but focusable — display:none inputs cannot take focus.
    el.style.cssText = 'position:fixed;top:0;left:-9999px;width:1px;height:1px;opacity:0;';
    document.body.appendChild(el);
  }
  el.focus();
}

/** The destination field takes over; the bridge disappears. */
export function adoptKeyboard(target: HTMLInputElement | null): void {
  target?.focus();
  document.getElementById(BRIDGE_ID)?.remove();
}
