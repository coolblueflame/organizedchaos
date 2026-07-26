# Phase 4: Recurrence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tasks can repeat — "X days/weeks/months after completion" or on weekly/monthly cadences — with the spawn sweep wired to app open/focus and the 4am rollover, plus the Recurring management screen.

**Architecture:** The domain engine (P1's `recurrence.ts`) is done and tested; this phase is store lifecycle + UI. A template is created FROM a task (snapshotting its fields); the task links back via `recurrenceId`. Completing a linked task arms after-completion templates. `runSpawnSweep()` materializes due templates and is called from `init()`, window focus, and a timer parked on the next rollover.

**Spec:** §5 (all), §6 Recurring screen + editor row. No new dependencies.

## Global Constraints

(All prior globals apply.)

- Template snapshots are taken at creation; later task edits do NOT retro-update the template. Editing a template affects future spawns only (spec §5).
- Deleting a template never deletes tasks; deleting a task never deletes its template.
- `completeTask` must stay safe when `recurrenceId` dangles (template deleted).

---

### Task 1: Store recurrence lifecycle (TDD)

**Files:** modify `src/lib/state/app.svelte.ts`; extend `src/lib/state/app.test.ts`.

**Interfaces (produces):**

```ts
createRecurring(taskId: string, mode: RecurrenceMode, deadlineOffsetDays?: number): Promise<RecurrenceTemplate>;
  // snapshot task fields → template; task.recurrenceId = tpl.id;
  // scheduled modes arm nextSpawnAt = nextScheduledSpawn(mode, now); afterCompletion stays unarmed
updateRecurring(id: string, patch: Partial<RecurrenceTemplate>): Promise<void>;
  // when patch changes a scheduled mode, re-arm nextSpawnAt accordingly
removeRecurring(id: string): Promise<void>;               // tombstone template only
runSpawnSweep(now?: Date): Promise<number>;               // returns spawn count; persists drafts + template updates
// completeTask() gains: if the task links an afterCompletion template (live, unpaused),
// arm tpl.nextSpawnAt = scheduleAfterCompletion(tpl, completion date)
```

**Test cases (append to app.test.ts):**
1. `createRecurring` weekly arms `nextSpawnAt` in the future, links `task.recurrenceId`, snapshots name/priority; persists.
2. `createRecurring` afterCompletion leaves `nextSpawnAt` undefined; completing the task arms it to completion+interval (`vi.setSystemTime`).
3. Completing with a dangling `recurrenceId` does not throw.
4. `runSpawnSweep` past a weekly `nextSpawnAt`: spawns exactly one open task (correct listId/name/recurrenceId), advances `nextSpawnAt` a week; second sweep same day spawns nothing (skip-if-open + advanced schedule).
5. `runSpawnSweep` for a due afterCompletion template spawns and clears `nextSpawnAt`.
6. Paused template never spawns; `removeRecurring` tombstones (gone from state, `deleted` on disk).

- [ ] Tests → fail → implement → pass → full suite → commit `feat: store recurrence lifecycle + spawn sweep`

---

### Task 2: RecurrenceEditor + TaskEditor integration

**Files:** create `src/lib/ui/RecurrenceEditor.svelte`; modify `src/lib/ui/TaskEditor.svelte`.

**RecurrenceEditor** (pure form, no store access): props `{ initial?: { mode: RecurrenceMode; deadlineOffsetDays?: number }, onsave(mode, offset), oncancel, onremove? }`.
- Mode segmented control: `after completion` / `weekly` / `monthly` (`recur-mode-<kind>`).
- afterCompletion: interval number (`recur-interval`) + unit select days/weeks/months (`recur-unit`).
- weekly: seven weekday toggle chips Mo–Su (`recur-weekday-<0..6>`, JS getDay numbering, display order Mon-first).
- monthly: day-of-month number 1–31 (`recur-monthday`).
- Optional "deadline X days after it appears" number (`recur-deadline-offset`, empty = none).
- Save (`recur-save`) validates (weekly needs ≥1 day; interval ≥1) and calls `onsave`.

**TaskEditor**: the placeholder row becomes live (`task-recur-row`):
- No template: "↻ make recurring" → expands RecurrenceEditor → save calls `app.createRecurring(task.id, mode, offset)`.
- Linked template (`app.state.templates.find(t => t.id === task.recurrenceId && !t.deleted)`): row shows a human summary — "↻ every Mon, Fri", "↻ 3 days after completion", "↻ monthly on the 15th" (+ " · deadline +Nd" when offset set) — tap to edit (RecurrenceEditor with initial values → `updateRecurring`), plus "stop repeating" (`recur-remove` → `removeRecurring`).

- [ ] Implement; `npm run check`; commit `feat: recurrence editor in task editor`

---

### Task 3: Recurring screen

**Files:** create `src/lib/ui/RecurringView.svelte`; modify `router.svelte.ts` (`{name:'recurring'}` ⇄ `#/recurring`), `App.svelte`, `Home.svelte` (footer link `recurring-link`, "↻ Recurring (n)").

**Rows** (`recurring-row-<id>`): template name + cadence summary + next-spawn ("next: 7/28 4:00" / "after next completion" / "paused"); actions: pause/resume (`recurring-pause-<id>`), edit (inline RecurrenceEditor → `updateRecurring`), delete (`recurring-delete-<id>`, confirm + undo toast via `updateRecurring(id, {deleted:false})` closure — reuse toast pattern with a restore that flips the tombstone).

- [ ] Implement; check; commit `feat: recurring templates screen`

---

### Task 4: Sweep wiring + e2e + gate

**Files:** modify `src/lib/state/app.svelte.ts` (`init` calls `runSpawnSweep`), `src/App.svelte` (visibilitychange → sweep; `setTimeout` parked on `nextRolloverTs` that sweeps + re-arms itself); create `e2e/recurrence.spec.ts`.

**E2E** (uses Playwright's clock API to time-travel):

```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('organizedchaos');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    }),
  );
  await page.reload();
  await page.getByTestId('new-list').waitFor();
});

test('after-completion task respawns after the interval (clock time-travel)', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Rec');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('water plants');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill('3');
  await page.getByTestId('recur-save').click();
  await page.getByTestId('task-collapse').click();

  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(0);

  // 4 days later, reopening the app resurrects it (init sweep)
  await page.clock.install({ time: Date.now() + 4 * 86_400_000 });
  await page.reload();
  await page.getByTestId('back').waitFor();
  await expect(page.getByTestId(/^task-row-/).first()).toContainText('water plants');
});

test('recurring screen lists, pauses, and deletes templates', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Rec');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('weekly thing');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-weekly').click();
  await page.getByTestId('recur-weekday-1').click();
  await page.getByTestId('recur-save').click();
  await page.getByTestId('back').click();

  await page.getByTestId('recurring-link').click();
  const row = page.getByTestId(/^recurring-row-/).first();
  await expect(row).toContainText('weekly thing');
  const id = (await row.getAttribute('data-testid'))!.replace('recurring-row-', '');
  await page.getByTestId(`recurring-pause-${id}`).click();
  await expect(row).toContainText('paused');
  page.on('dialog', (d) => void d.accept());
  await page.getByTestId(`recurring-delete-${id}`).click();
  await expect(page.getByTestId(`recurring-row-${id}`)).toHaveCount(0);
});
```

Caveat: `page.clock.install` after load replaces timers — install BEFORE `reload()` so the fresh page boots under the shifted clock (as written). If webkit's clock support misbehaves, scope the time-travel test to chromium with `test.skip(({ browserName }) => browserName === 'webkit')` and note it.

- [ ] e2e green (both projects or documented skip); unit suite + check green; commit `test: recurrence e2e`; push; CI green; live verify; memory update.

---

## Self-Review Notes

- **Spec §5 coverage:** both modes ✔, deadlineOffset / priority inheritance (domain, tested in P1) ✔, skip-if-open ✔ (domain + store test 4), sweep at open/focus/rollover ✔ (Task 4), Recurring screen with edit/pause/delete ✔, template-affects-future-only ✔ (snapshot semantics), completion arming ✔.
- **Type consistency:** `createRecurring` snapshot uses the same field names as `RecurrenceTemplate` (P1 types); `runSpawnSweep` persists `SweepResult.updates` via `updateTemplate` (P2 store) which uses read-modify-put so clearing `nextSpawnAt: undefined` sticks (verified in P1.7 tests).
- **Judgment call:** template deletion undo uses tombstone-flip restore (same pattern as tasks) rather than trash-map since templates stay in `state.templates` filtered views.
