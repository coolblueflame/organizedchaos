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
  | { name: 'list'; id: string }
  | { name: 'sort'; mode: 'date' | 'priority' | 'tag' }
  | { name: 'completed' }
  | { name: 'randomizer'; listId?: string }
  | { name: 'inprogress' }
  | { name: 'recurring' }
  | { name: 'settings' }
  | { name: 'import' };

function parse(hash: string): Route {
  const parts = hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  if (parts[0] === 'list' && parts[1]) return { name: 'list', id: parts[1] };
  if (parts[0] === 'sort' && (parts[1] === 'date' || parts[1] === 'priority' || parts[1] === 'tag')) {
    return { name: 'sort', mode: parts[1] };
  }
  if (parts[0] === 'completed') return { name: 'completed' };
  if (parts[0] === 'randomizer') return { name: 'randomizer', listId: parts[1] };
  if (parts[0] === 'inprogress') return { name: 'inprogress' };
  if (parts[0] === 'recurring') return { name: 'recurring' };
  if (parts[0] === 'settings') return { name: 'settings' };
  if (parts[0] === 'import') return { name: 'import' };
  return { name: 'home' };
}

function toHash(r: Route): string {
  switch (r.name) {
    case 'home': return '#/';
    case 'list': return `#/list/${r.id}`;
    case 'sort': return `#/sort/${r.mode}`;
    case 'completed': return '#/completed';
    case 'randomizer': return r.listId ? `#/randomizer/${r.listId}` : '#/randomizer';
    case 'inprogress': return '#/inprogress';
    case 'recurring': return '#/recurring';
    case 'settings': return '#/settings';
    case 'import': return '#/import';
  }
}

class Router {
  current: Route = $state({ name: 'home' });

  constructor() {
    if (typeof window !== 'undefined') {
      this.current = parse(window.location.hash);
      window.addEventListener('hashchange', () => {
        this.current = parse(window.location.hash);
      });
    }
  }
}

export const router = new Router();

export function navigate(r: Route): void {
  window.location.hash = toHash(r);
}

export function back(): void {
  history.back();
}
