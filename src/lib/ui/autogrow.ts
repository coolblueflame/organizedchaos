/**
 * Textarea autogrow: the field is always exactly as tall as its content, so
 * the whole description is visible and the field itself never scrolls.
 *
 * It used to cap at ~2.5x and become an inner scroller, which is unusable on
 * iOS (reported 2026-08-03): dragging inside a scrollable textarea pans the
 * PAGE, so the hidden text below simply could not be reached. A field that
 * never scrolls has nothing to trap the gesture — the page scrolls, which is
 * what the finger expected in the first place.
 */
export function autogrow(el: HTMLTextAreaElement, _value?: string) {
  const fit = () => {
    el.style.height = 'auto';
    // +2 covers the border box: scrollHeight is content-box, and coming up
    // short by a pixel is what re-introduces a one-line scrollbar.
    el.style.height = `${el.scrollHeight + 2}px`;
  };

  el.style.overflowY = 'hidden'; // no inner scrollbar to catch a drag
  el.addEventListener('input', fit);

  /*
    A task opened with a long saved description must start grown, but at mount
    the element may not have been laid out yet (display:none ancestor, an
    editor still animating open) and scrollHeight reads 0. One extra measure on
    the next frame catches that without a resize observer.
  */
  fit();
  requestAnimationFrame(fit);

  return {
    /** The bound value can change from outside (checklist edits rewrite notes). */
    update: fit,
    destroy() {
      el.removeEventListener('input', fit);
    },
  };
}
