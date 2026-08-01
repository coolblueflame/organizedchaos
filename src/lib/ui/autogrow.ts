/**
 * Textarea autogrow (2026-08-01 ask): start at the CSS height, grow with the
 * text up to ~2.5× that, then become a scroller. Pure height adjustment — the
 * value binding stays whoever's it was.
 */
export function autogrow(el: HTMLTextAreaElement) {
  const base = el.clientHeight || 56;
  const max = Math.round(base * 2.5);

  const fit = () => {
    el.style.height = 'auto';
    const wanted = el.scrollHeight;
    el.style.height = `${Math.min(wanted, max)}px`;
    el.style.overflowY = wanted > max ? 'auto' : 'hidden';
  };

  el.addEventListener('input', fit);
  fit(); // a task opened with a long saved description starts grown
  return {
    destroy() {
      el.removeEventListener('input', fit);
    },
  };
}
