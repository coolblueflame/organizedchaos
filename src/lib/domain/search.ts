/**
 * Task search. Matches every whitespace-separated term against the task's name
 * and notes (AND, case-insensitive substring), so "buy milk" finds "milk — buy
 * some" without needing exact phrasing.
 *
 * Results come back split: live work first, finished work after, since a
 * search is usually "where is that thing" and only sometimes "did I do that".
 */
import { effectivePriority } from './priority';
import { priorityRank, type Settings, type Task } from './types';

export interface SearchResults {
  open: Task[];
  completed: Task[];
  /** Terms actually used, for highlighting / empty-state copy. */
  terms: string[];
}

function terms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matches(task: Task, needles: string[]): boolean {
  const hay = `${task.name}\n${task.notes}`.toLowerCase();
  return needles.every((n) => hay.includes(n));
}

export function searchTasks(
  tasks: Task[],
  query: string,
  settings: Settings,
  now: Date,
): SearchResults {
  const needles = terms(query);
  if (needles.length === 0) return { open: [], completed: [], terms: [] };

  const hits = tasks.filter((t) => !t.deleted && matches(t, needles));

  const open = hits
    .filter((t) => t.completedAt === undefined)
    .sort((a, b) => {
      const byPriority =
        priorityRank(effectivePriority(b, settings, now)) -
        priorityRank(effectivePriority(a, settings, now));
      if (byPriority !== 0) return byPriority;
      // then soonest deadline, deadline-less last
      if (a.deadline === b.deadline) return 0;
      if (a.deadline === undefined) return 1;
      if (b.deadline === undefined) return -1;
      return a.deadline < b.deadline ? -1 : 1;
    });

  const completed = hits
    .filter((t) => t.completedAt !== undefined)
    .sort((a, b) => b.completedAt! - a.completedAt!);

  return { open, completed, terms: needles };
}
