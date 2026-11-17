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
  keepId?: string,
): SearchResults {
  const needles = terms(query);
  if (needles.length === 0) {
    return { open: [], completed: [], openTotal: 0, completedTotal: 0, terms: [] };
  }

  const open: Task[] = [];
  const completed: Task[] = [];
  for (const task of tasks) {
    // The kept task (one open in its editor) counts as a match even after an
    // edit stops it matching, so renaming "yoga" to "do yoga" can't pull the
    // row out from under the caret mid-word.
    if (task.deleted || (task.id !== keepId && !matches(task, needles))) continue;
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
    open: head(open, limit, keepId),
    completed: head(completed, limit, keepId),
    openTotal: open.length,
    completedTotal: completed.length,
    terms: needles,
  };
}

/**
 * The first `limit` tasks, with the kept task guaranteed a place: an edit
 * that re-ranks it (a lower priority) must not slice it off the end.
 * @param tasks Sorted matches.
 * @param limit Most rows to return.
 * @param keepId The task that must stay visible, if it is among `tasks`.
 * @returns At most `limit` tasks.
 */
function head(tasks: Task[], limit: number, keepId: string | undefined): Task[] {
  const shown = tasks.slice(0, limit);
  if (keepId === undefined || shown.some((t) => t.id === keepId)) return shown;
  const kept = tasks.find((t) => t.id === keepId);
  if (kept && shown.length > 0) shown[shown.length - 1] = kept;
  return shown;
}
