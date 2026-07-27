/**
 * Per-list active hours: a list can declare the window during which the
 * randomizer is allowed to draw from it (e.g. work 09:00–17:00, wind-down
 * 17:00–09:00). Windows are local wall-clock and may wrap past midnight.
 *
 * Scope is deliberately narrow: hours only ever affect the randomizer's
 * default pool. Lists, sort views, and the current task ignore them entirely.
 */
import type { List } from './types';

/** 'HH:MM' → minutes since local midnight. */
function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

export function hasWindow(list: List): boolean {
  return Boolean(list.activeFrom && list.activeTo && list.activeFrom !== list.activeTo);
}

/**
 * Is `list` in its active window at `now`? Lists without a window are always
 * active. Start is inclusive, end exclusive, so 09:00–17:00 is live at 9:00
 * sharp and done at 17:00 sharp.
 */
export function isListActiveAt(list: List, now: Date): boolean {
  if (!hasWindow(list)) return true;
  const from = toMinutes(list.activeFrom!);
  const to = toMinutes(list.activeTo!);
  const current = now.getHours() * 60 + now.getMinutes();
  return from < to
    ? current >= from && current < to
    : current >= from || current < to; // wraps past midnight
}

/** Compact label for the UI, e.g. "9:00–17:00"; null when unscheduled. */
export function describeWindow(list: List): string | null {
  if (!hasWindow(list)) return null;
  const trim = (hhmm: string) => hhmm.replace(/^0/, '');
  return `${trim(list.activeFrom!)}–${trim(list.activeTo!)}`;
}
