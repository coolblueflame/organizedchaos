/**
 * Per-list active hours: when the randomizer is allowed to draw from a list.
 *
 * A list carries a set of RULES, each covering some weekdays and a local
 * wall-clock window that may wrap past midnight — so "office 9–5 on weekdays"
 * and "chores 10–4 at weekends" can coexist on different lists, and a single
 * list can have different hours on different days.
 *
 * Scope is deliberately narrow: hours only ever affect the randomizer's
 * default pool. Lists, sort views, and the current task ignore them entirely.
 */
import { effectivePriority } from './priority';
import type { List, Settings, Task } from './types';

/** Weekday numbers are JS `Date#getDay`: 0 = Sunday … 6 = Saturday. */
export interface HoursRule {
  days: number[];
  from: string; // 'HH:MM'
  to: string;   // 'HH:MM'
}

export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];
export const WEEKDAYS = [1, 2, 3, 4, 5];
export const WEEKEND = [0, 6];

/** 'HH:MM' → minutes since local midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/**
 * A list's rules, including the pre-rules `activeFrom`/`activeTo` shape as a
 * single all-week rule so older data keeps working untouched.
 */
export function hoursRules(list: List): HoursRule[] {
  if (list.hours?.length) return list.hours;
  if (list.activeFrom && list.activeTo && list.activeFrom !== list.activeTo) {
    return [{ days: ALL_DAYS, from: list.activeFrom, to: list.activeTo }];
  }
  return [];
}

export function hasWindow(list: List): boolean {
  return hoursRules(list).length > 0;
}

/** Exported for rituals, which ask the same question about a task's window. */
export function ruleActiveAt(rule: HoursRule, now: Date): boolean {
  if (rule.days.length === 0) return false;
  const from = toMinutes(rule.from);
  const to = toMinutes(rule.to);
  const current = now.getHours() * 60 + now.getMinutes();
  const today = now.getDay();
  if (from === to) return rule.days.includes(today); // degenerate: treat as all day
  if (from < to) return rule.days.includes(today) && current >= from && current < to;
  // Wraps past midnight: the tail belongs to the day the window STARTED on.
  const yesterday = (today + 6) % 7;
  return (
    (rule.days.includes(today) && current >= from) ||
    (rule.days.includes(yesterday) && current < to)
  );
}

/** Lists with no rules are always active; otherwise any matching rule wins. */
export function isListActiveAt(list: List, now: Date): boolean {
  const rules = hoursRules(list);
  if (rules.length === 0) return true;
  return rules.some((r) => ruleActiveAt(r, now));
}

/**
 * Which tasks the clock is currently holding back. A list outside its window
 * blocks everything it owns — except, when `urgentOverridesHours` is set, its
 * MAX-priority work (effective priority, so a deadline that escalated a task
 * to max gets through too).
 */
export function tasksBlockedByHours(
  tasks: Task[],
  lists: List[],
  settings: Settings,
  now: Date,
): string[] {
  const byId = new Map(lists.map((l) => [l.id, l]));
  const blocked: string[] = [];
  for (const task of tasks) {
    const list = byId.get(task.listId);
    if (!list || isListActiveAt(list, now)) continue;
    if (list.urgentOverridesHours && effectivePriority(task, settings, now) === 'max') continue;
    blocked.push(task.id);
  }
  return blocked;
}

const DAY_LETTERS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

function describeDays(days: number[]): string {
  const set = [...days].sort();
  if (set.length === 7) return 'daily';
  if (set.join() === WEEKDAYS.join()) return 'weekdays';
  if (set.join() === WEEKEND.join()) return 'weekends';
  // Sunday-first, like every day picker (the review caught this renderer and
  // recurrenceText's still saying Monday after the 2026-08-06 picker flip).
  return [0, 1, 2, 3, 4, 5, 6].filter((d) => set.includes(d)).map((d) => DAY_LETTERS[d]).join('');
}

const trimTime = (hhmm: string) => hhmm.replace(/^0/, '');

/** Compact label, e.g. "weekdays 9:00–17:00"; null when unscheduled. */
export function describeWindow(list: List): string | null {
  const rules = hoursRules(list);
  if (rules.length === 0) return null;
  return rules
    .map((r) => {
      const window = `${trimTime(r.from)}–${trimTime(r.to)}`;
      const days = describeDays(r.days);
      // An all-week rule needs no day prefix — that's just "the hours".
      return days === 'daily' ? window : `${days} ${window}`;
    })
    .join(' · ');
}
