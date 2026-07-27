/**
 * "Close the open thing" plumbing shared by every screen with an expandable
 * task row: a click anywhere outside it, or Escape, collapses it.
 *
 * Both paths blur the focused field FIRST. Field edits flush on blur, and
 * pointerdown fires before blur — so closing without this would race a
 * half-saved name straight into the pristine-discard check.
 */
export function closeOnOutsideOrEscape(isOpen: () => boolean, close: () => void): () => void {
  const flushFocus = () => {
    const el = document.activeElement;
    if (el instanceof HTMLElement) el.blur();
  };

  const onPointerDown = (e: PointerEvent) => {
    if (!isOpen()) return;
    const el = e.target as Element | null;
    // The new-task button runs its own close first; swallowing it would eat the task.
    if (el?.closest('[data-editing-root]') || el?.closest('[data-testid="new-task"]')) return;
    flushFocus();
    close();
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== 'Escape' || !isOpen()) return;
    flushFocus();
    close();
  };

  document.addEventListener('pointerdown', onPointerDown);
  document.addEventListener('keydown', onKeyDown);
  return () => {
    document.removeEventListener('pointerdown', onPointerDown);
    document.removeEventListener('keydown', onKeyDown);
  };
}
