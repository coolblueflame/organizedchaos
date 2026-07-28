/**
 * Svelte action for paged rendering: call `grow` whenever the sentinel node
 * approaches the viewport, so the next page of rows mounts before the user
 * reaches the gap rather than after they notice it.
 *
 * Exists because building every row of a large library at once is the app's
 * recurring failure mode — it took search down, stalled the priority view, and
 * froze the completed screen. Any view that renders one component per task
 * must go through a budget like this.
 */
export function revealOnApproach(node: HTMLElement, grow: () => void) {
  const observer = new IntersectionObserver((entries) => {
    if (entries.some((entry) => entry.isIntersecting)) grow();
  }, { rootMargin: '600px' }); // load ahead of the scroll, not behind it
  observer.observe(node);
  return { destroy: () => observer.disconnect() };
}
