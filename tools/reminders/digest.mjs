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
 *
 * LOCKED lists get a split treatment, and the split is the whole point: their
 * deadlines still COUNT (a real obligation doesn't stop mattering because
 * it's private) but their names are never spoken. A push lands on a lock
 * screen in front of whoever is standing there — naming a task out of the
 * one list guarded by a PIN would undo the feature from the outside.
 */
export function buildDigest(tasks, lists, todayKey) {
  const archived = new Set(lists.filter((l) => l.archived === true).map((l) => l.id));
  const locked = new Set(lists.filter((l) => l.locked === true).map((l) => l.id));
  const due = tasks.filter((t) =>
    !t.deleted && t.completedAt === undefined && t.deadline !== undefined &&
    t.deadline <= todayKey && !archived.has(t.listId));
  if (due.length === 0) return null;

  const overdue = due.filter((t) => t.deadline < todayKey);
  const today = due.filter((t) => t.deadline === todayKey);
  // The single most pressing NAMEABLE task makes the push concrete: oldest
  // deadline first, so the longest-overdue thing leads. All of them private?
  // Then the counts stand alone rather than borrowing a name they shouldn't.
  const top = due
    .filter((t) => !locked.has(t.listId))
    .sort((a, b) => (a.deadline < b.deadline ? -1 : 1))[0];

  const parts = [];
  if (overdue.length > 0) parts.push(`${overdue.length} overdue`);
  if (today.length > 0) parts.push(`${today.length} due today`);
  const headline = parts.join(', ');
  return {
    title: overdue.length > 0 ? '🔥 the deadlines are circling' : '☀️ due today',
    body: top
      ? `${headline} — top of the pile: "${(top.name || 'untitled').slice(0, 60)}"`
      : headline,
    tag: 'oc-daily-digest',
    counts: { overdue: overdue.length, today: today.length },
  };
}

/**
 * The latency probe (2026-08-05): a push whose body states the moment it was
 * sent, so the gap to when the phone actually buzzes can be read off rather
 * than guessed at.
 *
 * The number this measures is the one the whole scheduled-alarm idea rests
 * on. Scheduling to the second is easy and free; whether iOS *delivers* to
 * the second is Apple's business, and a timer that rings whenever is not a
 * timer. Sent at high urgency because that is what a real alarm would use —
 * measuring a gentler push would flatter the result.
 */
export function buildPing(now, timeZone) {
  const clock = new Intl.DateTimeFormat('en-GB', {
    timeZone, hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);
  return {
    title: '⏱ latency test',
    body: `sent at ${clock} — check the clock now, the gap is the answer.`,
    tag: `oc-latency-${now.getTime()}`, // unique: never collapses onto a previous probe
  };
}
