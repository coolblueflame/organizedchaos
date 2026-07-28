/**
 * Scale guard for the paths that run on every render.
 *
 * Written ahead of a large Things import — years of logbook arrive at once, and
 * an accidental O(n²) in any of these would turn a keystroke into a stutter for
 * someone who cannot simply delete their history to get the app back. The
 * dependency solver already proved that failure mode is reachable in practice.
 *
 * Budgets sit far above the measured cost (single-digit ms at this size) so a
 * slower CI box never makes this flaky; they exist to catch a change in
 * complexity, not to police milliseconds.
 */
import { describe, expect, it } from 'vitest';
import { blockLifts } from './blocking';
import { drawTask, eligibleForDraw } from './randomizer';
import { burdenSeries, completionCounts, completionSeries } from './stats';
import { groupByPriority, groupCompleted, openTasks } from './views';
import { searchTasks } from './search';
import { projectPriorities } from './project';
import { DEFAULT_SETTINGS, priorityRank, type List, type Task } from './types';
import { effectivePriority } from './priority';

const NOW = new Date('2026-07-28T12:00:00');
const DAY = 86_400_000;

function build(openCount: number, doneCount: number) {
  const lists: List[] = Array.from({ length: 25 }, (_, i) => ({
    id: `l${i}`, title: `List ${i}`, sortMode: 'priority',
    createdAt: 0, updatedAt: 0, deleted: false,
  }));
  const tasks: Task[] = [];
  for (let i = 0; i < openCount; i += 1) {
    tasks.push({
      id: `o${i}`, listId: `l${i % 25}`, name: `open task ${i}`, notes: '',
      priority: (['someday', 'low', 'medium', 'high', 'max'] as const)[i % 5]!,
      tagIds: [], inProgress: false, createdAt: 0, updatedAt: 0, deleted: false,
      estimateHours: 1 + (i % 4),
    });
  }
  // Three years of logbook, which is what a long-time Things user brings over.
  for (let i = 0; i < doneCount; i += 1) {
    tasks.push({
      id: `d${i}`, listId: `l${i % 25}`, name: `done task ${i}`, notes: '',
      priority: 'medium', tagIds: [], inProgress: false,
      createdAt: NOW.getTime() - (i % 1095) * DAY,
      updatedAt: 0, deleted: false, importedHistory: true,
      completedAt: NOW.getTime() - (i % 1095) * DAY,
    });
  }
  return { lists, tasks };
}

const time = (label: string, fn: () => unknown): number => {
  const t0 = performance.now();
  fn();
  const ms = performance.now() - t0;
  console.log(`  ${label}: ${ms.toFixed(1)}ms`);
  return ms;
};

describe('post-import scale', () => {
  it('hot paths stay responsive with a big library', () => {
    const { lists, tasks } = build(1500, 6000);
    console.log(`dataset: ${tasks.length} tasks / ${lists.length} lists`);

    const budgets: Array<[string, number, () => unknown]> = [
      ['eligibleForDraw', 50, () => eligibleForDraw(tasks, NOW)],
      ['blockLifts', 50, () => blockLifts(tasks, DEFAULT_SETTINGS, NOW)],
      ['drawTask', 60, () => drawTask(tasks, DEFAULT_SETTINGS, NOW, () => 0.5)],
      ['projectPriorities', 80, () => projectPriorities(lists, tasks, DEFAULT_SETTINGS, NOW)],
      ['completionCounts', 60, () => completionCounts(tasks, NOW, 4)],
      ['groupByPriority', 80, () => groupByPriority(openTasks(tasks), DEFAULT_SETTINGS, NOW)],
      ['groupCompleted', 200, () => groupCompleted(tasks, 4)],
      ['searchTasks', 80, () => searchTasks(tasks, 'task 42', DEFAULT_SETTINGS, NOW)],
      ['completionSeries(12 months)', 150, () => completionSeries(tasks, 'month', 12, NOW, 4)],
      ['completionSeries(90 days)', 150, () => completionSeries(tasks, 'day', 90, NOW, 4)],
      ['burdenSeries(90 days)', 400, () => burdenSeries(tasks, 90, NOW, 4)],
    ];

    for (const [label, budget, fn] of budgets) {
      expect(time(label, fn), `${label} over budget`).toBeLessThan(budget);
    }
  });
});

describe('search at a real library size', () => {
  // Reported 2026-07-28: typing "A" against a 25,000-task library hung, further
  // keystrokes did nothing, and the page eventually died. A single letter
  // matches most of a library, and every match was being turned into a row.
  const BIG = Array.from({ length: 25_000 }, (_, i) => ({
    id: `t${i}`, listId: 'L1', name: `Arctic Monkeys track ${i}`, notes: 'a note about it',
    tagIds: [], priority: (['low', 'medium', 'high'] as const)[i % 3]!,
    inProgress: false, createdAt: 0, updatedAt: 0, deleted: false,
    ...(i % 4 === 0 ? { completedAt: 1_700_000_000_000 + i } : {}),
    ...(i % 7 === 0 ? { deadline: '2026-08-01' } : {}),
  })) as Task[];

  it('a single letter matching everything stays fast and bounded', () => {
    const started = performance.now();
    const r = searchTasks(BIG, 'a', DEFAULT_SETTINGS, new Date());
    const elapsed = performance.now() - started;

    expect(r.openTotal, 'it really does match the whole library').toBe(18_750);
    expect(r.open.length, 'but only a screenful is handed to the UI').toBeLessThanOrEqual(50);
    expect(r.completed.length).toBeLessThanOrEqual(50);
    expect(elapsed, `one keystroke took ${elapsed.toFixed(0)}ms`).toBeLessThan(150);
  });

  it('keeps the best matches, not merely the first fifty found', () => {
    const r = searchTasks(BIG, 'arctic', DEFAULT_SETTINGS, new Date());
    const ranks = r.open.map((t) => priorityRank(effectivePriority(t, DEFAULT_SETTINGS, new Date())));
    expect(ranks, 'the head of a sorted list, not an arbitrary slice')
      .toEqual([...ranks].sort((a, b) => b - a));
  });

  it('a whole word of typing stays fast too', () => {
    const started = performance.now();
    for (const q of ['a', 'ar', 'arc', 'arct', 'arcti', 'arctic']) {
      searchTasks(BIG, q, DEFAULT_SETTINGS, new Date());
    }
    const elapsed = performance.now() - started;
    expect(elapsed, `typing "arctic" cost ${elapsed.toFixed(0)}ms of scanning`).toBeLessThan(600);
  });
});
