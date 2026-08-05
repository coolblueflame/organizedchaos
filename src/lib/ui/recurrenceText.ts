/** Human-readable cadence summaries shared by TaskEditor and RecurringView. */
import type { RecurrenceMode } from '../domain/types';

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
}

export function describeRecurrence(mode: RecurrenceMode, deadlineOffsetDays?: number): string {
  let base: string;
  switch (mode.kind) {
    case 'afterCompletion':
      base = `${mode.interval} ${mode.interval === 1 ? mode.unit.slice(0, -1) : mode.unit} after completion`;
      break;
    case 'weekly': {
      // Sunday-first, matching the picker above it.
      const order = [0, 1, 2, 3, 4, 5, 6];
      const days = order.filter((d) => mode.weekdays.includes(d)).map((d) => DAY_NAMES[d]);
      base = `every ${days.join(', ')}`;
      break;
    }
    case 'monthly':
      base = `monthly on the ${ordinal(mode.dayOfMonth)}`;
      break;
  }
  // !== undefined, not truthy: 0 is "due the day it appears" and must show.
  if (deadlineOffsetDays === undefined) return base;
  return deadlineOffsetDays === 0
    ? `${base} · due same day`
    : `${base} · deadline +${deadlineOffsetDays}d`;
}
