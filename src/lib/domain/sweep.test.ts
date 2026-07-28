import { describe, expect, it } from 'vitest';
import { isLongSnooze, snoozeUntilTs, sweepQueue } from './sweep';
import type { List, Task } from './types';

let n = 0;
const list = (title: string, over: Partial<List> = {}): List =>
  ({ id: `L-${title}`, title, sortMode: 'priority', createdAt: 0, updatedAt: 0, deleted: false, ...over });

const task = (listId: string, createdAt: number, over: Partial<Task> = {}): Task => ({
  id: `t${n++}`, listId, name: `task-${n}`, notes: '', tagIds: [], priority: 'medium',
  inProgress: false, createdAt, updatedAt: createdAt, deleted: false, needsReview: true, ...over,
});

describe('sweepQueue', () => {
  it('holds only open tasks still wearing the review flag', () => {
    const l = list('A');
    const queue = sweepQueue([
      task(l.id, 1),
      task(l.id, 2, { needsReview: false }),
      task(l.id, 3, { completedAt: 99 }),
      task(l.id, 4, { deleted: true }),
    ], [l]);
    expect(queue).toHaveLength(1);
  });

  it('goes list by list in home order, oldest first within each', () => {
    const groupless = list('Inbox');
    const workA = list('Alpha', { areaGroup: 'Work' });
    const homeB = list('Beta', { areaGroup: 'Home' });
    const t1 = task(workA.id, 100);
    const t2 = task(workA.id, 50);
    const t3 = task(groupless.id, 200);
    const t4 = task(homeB.id, 10);

    const queue = sweepQueue([t1, t2, t3, t4], [workA, groupless, homeB]);
    // Ungrouped first, then groups alphabetically (Home before Work);
    // within Alpha the older task leads.
    expect(queue.map((t) => t.id)).toEqual([t3.id, t4.id, t2.id, t1.id]);
  });

  it('keeps tasks whose list is missing, at the end rather than lost', () => {
    const l = list('A');
    const orphan = task('gone-list', 1);
    const queue = sweepQueue([task(l.id, 5), orphan], [l]);
    expect(queue.map((t) => t.id)).toContain(orphan.id);
    expect(queue[queue.length - 1]!.id).toBe(orphan.id);
  });
});

describe('snoozeUntilTs', () => {
  it('lands on the rollover hour of the target day', () => {
    const now = new Date('2026-07-28T15:30:00');
    const ts = snoozeUntilTs(7, 4, now);
    expect(new Date(ts).getHours()).toBe(4);
    expect(new Date(ts).getDate()).toBe(4); // Aug 4
  });

  it('a re-drawable moment strictly in the future', () => {
    const now = new Date('2026-07-28T15:30:00');
    expect(snoozeUntilTs(1, 4, now)).toBeGreaterThan(now.getTime());
  });
});

describe('isLongSnooze', () => {
  const now = new Date('2026-07-28T15:00:00');

  it('is false for no snooze, an expired one, and a plain not-today', () => {
    const l = list('A');
    expect(isLongSnooze(task(l.id, 1), now, 4)).toBe(false);
    expect(isLongSnooze(task(l.id, 1, { notTodayUntil: now.getTime() - 1000 }), now, 4)).toBe(false);
    // Snoozed until tomorrow 4am = the ordinary Not Today — no marker.
    expect(isLongSnooze(task(l.id, 1, { notTodayUntil: snoozeUntilTs(1, 4, now) }), now, 4)).toBe(false);
  });

  it('is true once the snooze reaches past tomorrow', () => {
    const l = list('A');
    expect(isLongSnooze(task(l.id, 1, { notTodayUntil: snoozeUntilTs(7, 4, now) }), now, 4)).toBe(true);
  });
});
