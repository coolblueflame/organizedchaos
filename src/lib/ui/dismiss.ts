/**
 * "Close the open thing" plumbing shared by every screen with an expandable
 * task row: a TAP anywhere outside it, or Escape, collapses it.
 *
 * A tap, not a touch. The close used to fire on pointerdown — the instant a
 * finger landed — but on a phone the finger that lands on another row is
 * usually starting a SCROLL: the expanded editor runs off the bottom of the
 * screen, and dragging the list up is the natural next move (reported
 * 2026-07-29). So the decision waits for pointerup: little movement = a tap,
 * close (and on desktop, a plain click behaves identically); real movement =
 * a scroll or a drag, and the editor stays open.
 *
 * Both closing paths still blur the focused field FIRST. Field edits flush on
 * blur, and pointerup precedes the browser's own focus change — closing
 * without the explicit blur would race a half-saved name straight into the
 * pristine-discard check.
 */

/** Movement beyond this is a scroll/drag, not a tap. */
const TAP_SLOP_PX = 12;

export function closeOnOutsideOrEscape(isOpen: () => boolean, close: () => void): () => void {
  const flushFocus = () => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  };

  let start: { x: number; y: number; outside: boolean } | null = null;

  const onPointerDown = (e: PointerEvent) => {
    if (!isOpen()) { start = null; return; }
    const el = e.target as Element | null;
    // The new-task button runs its own close first; swallowing it would eat the task.
    const outside = !el?.closest('[data-editing-root]') && !el?.closest('[data-testid="new-task"]');
    start = { x: e.clientX, y: e.clientY, outside };
  };

  const onPointerUp = (e: PointerEvent) => {
    const s = start;
    start = null;
    if (!s || !s.outside || !isOpen()) return;
    if (Math.hypot(e.clientX - s.x, e.clientY - s.y) > TAP_SLOP_PX) return; // a scroll, not a tap
    flushFocus();
    close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    flushFocus();
    close();
  };

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('pointerup', onPointerUp);
  document.addEventListener('keydown', onKeyDown);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('pointerup', onPointerUp);
    document.removeEventListener('keydown', onKeyDown);
  };
}
