/**
 * Zero-dependency hash router. Routes:
 *   #/            → home
 *   #/list/<id>   → a single list
 *   #/sort/<mode> → global sort view (date | priority | tag)
 *   #/completed   → completed history
 * Unknown hashes fall back to home. Back/forward work for free via hashchange.
 */

export type Route =
  | { name: 'home' }
  | { name: 'list'; id: string; taskId?: string }
  | { name: 'sort'; mode: 'date' | 'priority' | 'tag' }
  | { name: 'completed' }
  | { name: 'randomizer'; listId?: string }
  | { name: 'inprogress' }
  | { name: 'recurring'; tplId?: string }
  | { name: 'settings' }
  | { name: 'import' }
  | { name: 'stats' }
  | { name: 'search' }
  | { name: 'tags' }
  | { name: 'rituals' }
  | { name: 'week' }
  | { name: 'wrapped' }
  | { name: 'sweep'; mode?: 'estimates' };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'list' && parts[1]) {
    // Optional deep link to one task, editor open: #/list/<id>/task/<taskId>.
    if (parts[2] === 'task' && parts[3]) return { name: 'list', id: parts[1], taskId: parts[3] };
    return { name: 'list', id: parts[1] };
  }
  if (parts[0] === 'sort' && (parts[1] === 'date' || parts[1] === 'priority' || parts[1] === 'tag')) {
    return { name: 'sort', mode: parts[1] };
  }
  if (parts[0] === 'completed') return { name: 'completed' };
  if (parts[0] === 'randomizer') return { name: 'randomizer', listId: parts[1] };
  if (parts[0] === 'inprogress') return { name: 'inprogress' };
  if (parts[0] === 'recurring') return { name: 'recurring', tplId: parts[1] };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'import') return { name: 'import' };
  if (parts[0] === 'stats') return { name: 'stats' };
  if (parts[0] === 'search') return { name: 'search' };
  if (parts[0] === 'tags') return { name: 'tags' };
  if (parts[0] === 'rituals') return { name: 'rituals' };
  if (parts[0] === 'week') return { name: 'week' };
  if (parts[0] === 'wrapped') return { name: 'wrapped' };
  if (parts[0] === 'sweep') {
    return parts[1] === 'estimates' ? { name: 'sweep', mode: 'estimates' } : { name: 'sweep' };
  }
  return { name: 'home' };
}

function toHash(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'list': return r.taskId ? `#/list/${r.id}/task/${r.taskId}` : `#/list/${r.id}`;
    case 'sort': return `#/sort/${r.mode}`;
    case 'completed': return '#/completed';
    case 'randomizer': return r.listId ? `#/randomizer/${r.listId}` : '#/randomizer';
    case 'inprogress': return '#/inprogress';
    case 'recurring': return r.tplId ? `#/recurring/${r.tplId}` : '#/recurring';
    case 'settings': return '#/settings';
    case 'import': return '#/import';
    case 'stats': return '#/stats';
    case 'search': return '#/search';
    case 'tags': return '#/tags';
    case 'rituals': return '#/rituals';
    case 'week': return '#/week';
    case 'wrapped': return '#/wrapped';
    case 'sweep': return r.mode === 'estimates' ? '#/sweep/estimates' : '#/sweep';
  }
}

class Router {
  current: Route = $state({ name: 'home' });

  constructor() {
    if (typeof window !== 'undefined') {
      this.current = parse(window.location.hash);
      window.addEventListener('hashchange', () => {
        this.current = parse(window.location.hash);
        // Screens swap in place, so the browser happily keeps the old scroll —
        // and most navigation starts from home's FOOTER, a page down, which
        // opened every screen pre-scrolled past its newest content. Every
        // screen opens at its top; predictable beats clever here.
        window.scrollTo(0, 0);
      });
    }
  }
}

export const router = new Router();

/**
 * The route the address bar says RIGHT NOW. `router.current` updates on the
 * async hashchange event, so immediately after a navigate() it can still hold
 * the previous screen — event handlers that branch on "where am I" (e.g. the
 * search shortcut deciding whether to clear the query) must read this instead.
 */
export function liveRoute(): Route {
  return parse(window.location.hash);
}

export function navigate(r: Route): void {
  window.location.hash = toHash(r);
}

export function back(): void {
  history.back();
}
