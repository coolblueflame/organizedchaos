/**
 * The morning digest, computed from the DATA repo's synced files by the
 * reminders workflow (see organizedchaos-data/.github/workflows/reminders.yml).
 * Plain .mjs so a bare `node` in CI can run it; unit-tested from the app's
 * vitest suite (src/lib/domain/reminderDigest.test.ts).
 */

/** Local YYYY-MM-DD for a Date in the given IANA timezone. */
export function localDayKey(date, timeZone) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(date);
}

/**
 * What the push should say, or null when there is nothing worth waking a
 * phone for. Deadlines are LOCAL date strings by the app's own convention;
 * tasks on archived lists are excluded exactly like the draw excludes them.
 */
export function buildDigest(tasks, lists, todayKey) {
  const archived = new Set(lists.filter((l) => l.archived === true).map((l) => l.id));
  const due = tasks.filter((t) =>
    !t.deleted && t.completedAt === undefined && t.deadline !== undefined &&
    t.deadline <= todayKey && !archived.has(t.listId));
  if (due.length === 0) return null;

  const overdue = due.filter((t) => t.deadline < todayKey);
  const today = due.filter((t) => t.deadline === todayKey);
  // The single most pressing name makes the push concrete: oldest deadline
  // first, so the longest-overdue thing leads.
  const top = [...due].sort((a, b) => (a.deadline < b.deadline ? -1 : 1))[0];

  const parts = [];
  if (overdue.length > 0) parts.push(`${overdue.length} overdue`);
  if (today.length > 0) parts.push(`${today.length} due today`);
  return {
    title: overdue.length > 0 ? '🔥 the deadlines are circling' : '☀️ due today',
    body: `${parts.join(', ')} — top of the pile: "${(top.name || 'untitled').slice(0, 60)}"`,
    tag: 'oc-daily-digest',
    counts: { overdue: overdue.length, today: today.length },
  };
}
