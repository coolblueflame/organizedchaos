/**
 * Per-list health — the numbers that answer "where should I point the sweep?"
 *
 * Deliberately measurement, not judgment: open count says how big a list is,
 * untriaged says how much of it has never been decided about, and median age
 * says whether it is a working list or a sediment layer. Sorted so the list
 * most in need of attention is at the top, which turns "my lists are a mess"
 * into "start with this one".
 */
import type { List, Task } from './types';

export interface ListHealthRow {
  list: List;
  open: number;
  untriaged: number;
  /** Median age of open tasks, in whole days. 0 when the list is empty. */
  medianAgeDays: number;
}

export function listHealth(lists: List[], tasks: Task[], now: Date): ListHealthRow[] {
  const open = tasks.filter((t) => !t.deleted && t.completedAt === undefined);
  const byList = new Map<string, Task[]>();
  for (const t of open) {
    const bucket = byList.get(t.listId) ?? [];
    bucket.push(t);
    byList.set(t.listId, bucket);
  }

  const rows = lists
    /*
      Only lists you could actually point a sweep AT (2026-08-03 ask). A list
      with nothing open has no health to report — its row was pure noise — and
      the dice's own generated vessels are transient by design: they hold a
      self-care draw for as long as it takes to do it, and nobody is ever going
      to triage one.
    */
    .filter((l) => !l.deleted && l.archived !== true && l.generated !== true)
    .map((list) => {
      const mine = byList.get(list.id) ?? [];
      const ages = mine
        .map((t) => Math.floor((now.getTime() - t.createdAt) / 86_400_000))
        .sort((a, b) => a - b);
      return {
        list,
        open: mine.length,
        untriaged: mine.filter((t) => t.needsReview === true).length,
        medianAgeDays: ages.length ? ages[Math.floor((ages.length - 1) / 2)]! : 0,
      };
    });

  // Untriaged work first (that is the actionable number), then sheer size.
  return rows
    .filter((r) => r.open > 0)
    .sort((a, b) => b.untriaged - a.untriaged || b.open - a.open
      || a.list.title.localeCompare(b.list.title));
}

/** "3d" / "4mo" / "2y" — ages compressed for a table column. */
export function shortAge(days: number): string {
  if (days < 1) return 'new';
  if (days < 30) return `${days}d`;
  if (days < 365) return `${Math.round(days / 30)}mo`;
  return `${Math.round(days / 365 * 10) / 10}y`;
}
