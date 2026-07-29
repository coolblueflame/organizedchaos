/**
 * Edge auto-scroll for pointer drags (2026-07-29 request): holding a drag near
 * the top or bottom of the screen scrolls the page, so a task can travel to a
 * destination that is not currently visible. Speed ramps with proximity —
 * enter the band and it creeps, park at the screen edge and it flies.
 *
 * The subtlety worth knowing: while the finger holds STILL at an edge, no
 * pointermove fires, but the page is moving under the pointer — so the drag's
 * hit-testing is stale the moment scrolling starts. The scroller therefore
 * reports every scrolled frame via `onScroll`, and the drag re-runs its
 * hit-test with the last known pointer position.
 */

/** How close to a screen edge (px) the scroll band begins. */
const EDGE = 96;
/** Fastest scroll, px per frame, reached only hard against the screen edge. */
const MAX_SPEED = 26;

/**
 * Quadratic ramp: gentle for most of the band, fast only near the very edge.
 * Linear felt twitchy — the band's inner half kept surprising the finger.
 */
export function edgeSpeed(depthIntoBand: number): number {
  const f = Math.min(1, Math.max(0, depthIntoBand) / EDGE);
  return f === 0 ? 0 : Math.max(2, Math.round(MAX_SPEED * f * f));
}

export function createDragScroller(onScroll: () => void) {
  let raf: number | null = null;
  let pointerY = Number.NaN;

  const tick = () => {
    raf = null;
    const h = window.innerHeight;
    let v = 0;
    if (pointerY < EDGE) v = -edgeSpeed(EDGE - pointerY);
    else if (pointerY > h - EDGE) v = edgeSpeed(pointerY - (h - EDGE));
    if (v === 0) return; // parked mid-screen: sleep until the next update()
    const before = window.scrollY;
    window.scrollBy(0, v);
    if (window.scrollY === before) return; // hit the end of the page: stop
    onScroll();
    raf = requestAnimationFrame(tick); // keep flowing while parked at the edge
  };

  return {
    /** Call on every pointermove while dragging. */
    update(clientY: number) {
      pointerY = clientY;
      if (raf === null) raf = requestAnimationFrame(tick);
    },
    /** Call on pointerup/cancel — never leave a drag scrolling the page. */
    stop() {
      if (raf !== null) cancelAnimationFrame(raf);
      raf = null;
      pointerY = Number.NaN;
    },
  };
}
