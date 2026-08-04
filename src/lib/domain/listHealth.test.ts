import { describe, expect, it } from 'vitest';
import { listHealth, shortAge } from './listHealth';
import type { List, Task } from './types';

const NOW = new Date('2026-07-28T12:00:00');
const daysAgo = (d: number) => NOW.getTime() - d * 86_400_000;

let n = 0;
const list = (title: string): List =>
  ({ id: `L-${title}`, title, sortMode: 'priority', createdAt: 0, updatedAt: 0, deleted: false });
const task = (listId: string, over: Partial<Task> = {}): Task => ({
  id: `t${n++}`, listId, name: 'x', notes: '', tagIds: [], priority: 'medium',
  inProgress: false, createdAt: daysAgo(0), updatedAt: 0, deleted: false, ...over,
});

describe('listHealth', () => {
  it('counts open and untriaged per list, ignoring done and deleted', () => {
    const a = list('A');
    const rows = listHealth([a], [
      task(a.id, { needsReview: true }),
      task(a.id),
      task(a.id, { completedAt: 1 }),
      task(a.id, { deleted: true, needsReview: true }),
    ], NOW);
    expect(rows[0]).toMatchObject({ open: 2, untriaged: 1 });
  });

  it('median age says sediment, not average dragged by one ancient task', () => {
    const a = list('A');
    const rows = listHealth([a], [
      task(a.id, { createdAt: daysAgo(1) }),
      task(a.id, { createdAt: daysAgo(3) }),
      task(a.id, { createdAt: daysAgo(3000) }), // one fossil must not define the list
    ], NOW);
    expect(rows[0]!.medianAgeDays).toBe(3);
  });

  it('ranks the list most in need of attention first', () => {
    const tidy = list('Tidy');
    const messy = list('Messy');
    const big = list('Big');
    const rows = listHealth([tidy, messy, big], [
      task(tidy.id),
      task(messy.id, { needsReview: true }),
      task(messy.id, { needsReview: true }),
      task(big.id), task(big.id), task(big.id),
    ], NOW);
    expect(rows.map((r) => r.list.title)).toEqual(['Messy', 'Big', 'Tidy']);
  });

  it('lists with nothing open drop out — the table is where to point a sweep', () => {
    // Reversed deliberately on 2026-08-03: an empty list has no health to
    // report, and its row was pure noise in a 77-list account.
    expect(listHealth([list('Empty')], [], NOW)).toEqual([]);
  });

  it('the dice\'s own generated vessels never show up', () => {
    // They hold a self-care draw until it is done; nobody triages one.
    const vessel = { ...list('summoned by the dice'), generated: true };
    const rows = listHealth([vessel], [
      task(vessel.id, { needsReview: true }),
    ], NOW);
    expect(rows).toEqual([]);
  });
});

describe('shortAge', () => {
  it('compresses to the unit a human would say', () => {
    expect(shortAge(0)).toBe('new');
    expect(shortAge(12)).toBe('12d');
    expect(shortAge(200)).toBe('7mo');
    expect(shortAge(3000)).toBe('8.2y');
  });
});
