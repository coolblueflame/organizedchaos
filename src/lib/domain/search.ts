/**
 * Task search. Matches every whitespace-separated term against the task's name
 * and notes (AND, case-insensitive substring), so "buy milk" finds "milk — buy
 * some" without needing exact phrasing.
 *
 * Results come back split: live work first, finished work after, since a
 * search is usually "where is that thing" and only sometimes "did I do that".
 *
 * Written to survive a large library. A single letter typed against 25,000
 * tasks matches most of them, and the counts are reported in full while only
 * the head of each list is returned — nobody reads result twelve thousand, and
 * handing that many rows to the UI is what took the screen down.
 */
import { effectivePriority } from './priority';
import { priorityRank, type RecurrenceTemplate, type Settings, type Task } from './types';

export interface SearchResults {
  /** The head of the matches, at most `limit` long. */
  open: Task[];
  completed: Task[];
  /** How many matched in total — what the counts should show. */
  openTotal: number;
  completedTotal: number;
  /** Terms actually used, for highlighting / empty-state copy. */
  terms: string[];
}

/** Enough to scroll through; small enough that the DOM stays cheap. */
export const SEARCH_LIMIT = 50;

function terms(query: string): string[] {
  return query.toLowerCase().split(/\s+/).filter(Boolean);
}

function matches(task: Task, needles: string[]): boolean {
  const hay = `${task.name}\n${task.notes}`.toLowerCase();
  return needles.every((n) => hay.includes(n));
}

/**
 * Recurring templates matching the same terms (2026-07-29 ask): a template's
 * spawned copy isn't always alive, so searching for "water the plants" could
 * come up empty while the rule quietly exists. Shown between open and
 * completed — more actionable than history, less urgent than live work.
 */
export function searchTemplates(
  templates: RecurrenceTemplate[],
  query: string,
  limit = 20,
): RecurrenceTemplate[] {
  const needles = terms(query);
  if (needles.length === 0) return [];
  return templates
    .filter(
      (t) => !t.deleted && needles.every((n) => `${t.name}\n${t.notes}`.toLowerCase().includes(n)),
    )
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, limit);
}

export function searchTasks(
  tasks: Task[],
  query: string,
  settings: Settings,
  now: Date,
  limit = SEARCH_LIMIT,
): SearchResults {
  const needles = terms(query);
  if (needles.length === 0) {
    return { open: [], completed: [], openTotal: 0, completedTotal: 0, terms: [] };
  }

  const open: Task[] = [];
  const completed: Task[] = [];
  for (const task of tasks) {
    if (task.deleted || !matches(task, needles)) continue;
    (task.completedAt === undefined ? open : completed).push(task);
  }

  // Rank once per task rather than inside the comparator. A comparator calls
  // its key function O(n log n) times, which on a library this size meant
  // hundreds of thousands of deadline-escalation calculations per keystroke.
  const rank = new Map<string, number>();
  for (const task of open) rank.set(task.id, priorityRank(effectivePriority(task, settings, now)));

  open.sort((a, b) => {
    const byPriority = rank.get(b.id)! - rank.get(a.id)!;
    if (byPriority !== 0) return byPriority;
    // then soonest deadline, deadline-less last
    if (a.deadline === b.deadline) return 0;
    if (a.deadline === undefined) return 1;
    if (b.deadline === undefined) return -1;
    return a.deadline < b.deadline ? -1 : 1;
  });
  completed.sort((a, b) => b.completedAt! - a.completedAt!);

  return {
    open: open.slice(0, limit),
    completed: completed.slice(0, limit),
    openTotal: open.length,
    completedTotal: completed.length,
    terms: needles,
  };
}
