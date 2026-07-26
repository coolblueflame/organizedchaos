# Phase 3: Randomizer + Current Task Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app's reason to exist: the big rotating-phrase button, the draw screen with Accept / Not Now / Not Today and list/tag filters, the persistent Current Task card on Home, "Make current" from any task, and the In Progress view.

**Architecture:** Domain `drawTask` (P1) already does all selection logic; this phase is store mutations + three UI surfaces. The randomizer is a routed screen (`#/randomizer` optionally scoped `#/randomizer/<listId>`) that owns the session-only "Not Now" exclusion set in component state — it dies with the screen, exactly per spec §4.

**Tech Stack:** unchanged; no new dependencies.

**Spec:** §4 (draw semantics — already domain-implemented), §6 items 2, 3 (big button, current task card), randomizer filters + Not Now (2026-07-26 amendment), In Progress view. Juice (slot-machine shuffle, particles) explicitly deferred to Phase 5 — this phase ships a plain fade reveal.

## Global Constraints

(All Phase 1/2 globals apply.)

- The exclusion set ("Not Now") must never touch storage — component state only.
- Accept/Not-Today mutations go through the store (persisted); the draw itself is pure.
- Exactly one current task; accepting while one exists returns the old one to the general pool (stays `inProgress`, per spec §4).
- The big button label re-rolls on every Home mount and after every accepted draw; never the same phrase twice in a row.

---

### Task 1: Store mutations for the draw lifecycle

**Files:**
- Modify: `src/lib/state/app.svelte.ts`
- Test: extend `src/lib/state/app.test.ts`

**Interfaces (produces):**

```ts
// added to AppStore:
acceptTask(taskId: string): Promise<void>;    // currentTask = {taskId, acceptedAt: now}, inProgress = true
sendNotToday(taskId: string): Promise<void>;  // notTodayUntil = nextRolloverTs(now, settings.rolloverHour); if current, clears current (stays inProgress)
clearCurrent(): Promise<void>;                // currentTask = null (task untouched)
setInProgress(taskId: string, flag: boolean): Promise<void>;
```

- [ ] **Step 1: Write failing tests**

```ts
// appended to src/lib/state/app.test.ts (inside the existing describe, reusing store/persisted helpers)
it('acceptTask sets current + inProgress; accepting another swaps current but keeps old inProgress', async () => {
  const list = await store.addList('L');
  const a = await store.addTask(list.id);
  const b = await store.addTask(list.id);
  await store.acceptTask(a.id);
  expect(store.state.currentTask?.taskId).toBe(a.id);
  expect(store.state.tasks.find((t) => t.id === a.id)!.inProgress).toBe(true);
  await store.acceptTask(b.id);
  expect(store.state.currentTask?.taskId).toBe(b.id);
  expect(store.state.tasks.find((t) => t.id === a.id)!.inProgress).toBe(true);
  expect((await persisted()).currentTask?.taskId).toBe(b.id);
});

it('sendNotToday snoozes until next 4am and clears current if it was current', async () => {
  vi.setSystemTime(new Date('2026-07-15T12:00:00'));
  const list = await store.addList('L');
  const a = await store.addTask(list.id);
  await store.acceptTask(a.id);
  await store.sendNotToday(a.id);
  const snoozed = store.state.tasks.find((t) => t.id === a.id)!;
  expect(snoozed.notTodayUntil).toBe(new Date('2026-07-16T04:00:00').getTime());
  expect(snoozed.inProgress).toBe(true); // stays in progress — only the pool is affected
  expect(store.state.currentTask).toBeNull();
  expect((await persisted()).tasks[0]!.notTodayUntil).toBe(snoozed.notTodayUntil);
});

it('clearCurrent leaves the task untouched', async () => {
  const list = await store.addList('L');
  const a = await store.addTask(list.id);
  await store.acceptTask(a.id);
  await store.clearCurrent();
  expect(store.state.currentTask).toBeNull();
  expect(store.state.tasks.find((t) => t.id === a.id)!.inProgress).toBe(true);
});

it('setInProgress toggles and persists', async () => {
  const list = await store.addList('L');
  const a = await store.addTask(list.id);
  await store.setInProgress(a.id, true);
  expect((await persisted()).tasks[0]!.inProgress).toBe(true);
  await store.setInProgress(a.id, false);
  expect((await persisted()).tasks[0]!.inProgress).toBe(false);
});
```

- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement** — `acceptTask`: `patchTask(id, {inProgress: true})`, `repo.setCurrentTask(ref)`, mirror. `sendNotToday`: `patchTask(id, {notTodayUntil: nextRolloverTs(Date.now(), settings.rolloverHour)})` (import from domain/time), then if `state.currentTask?.taskId === id` clear current. `clearCurrent`, `setInProgress`: trivial.
- [ ] **Step 4: Verify pass + full suite.**
- [ ] **Step 5: Commit** — `feat: add draw-lifecycle store mutations (accept, not-today, clear, in-progress)`

---

### Task 2: Button phrase pool

**Files:**
- Create: `src/lib/ui/phrases.ts`
- Test: `src/lib/ui/phrases.test.ts`

**Interfaces:** `export const PHRASES: readonly string[]` (70+ distinct entries) and `export function nextPhrase(rng?: () => number): string` — module remembers the last pick and never returns it twice consecutively.

- [ ] Test: PHRASES ≥ 60, all unique, all ≤ 32 chars (button must fit); 200 sequential `nextPhrase()` calls never repeat back-to-back.
- [ ] Implement — the pool mixes Ben's seeds ("Let's do this.", "Let's gooooo!", "BEAST MODE", "Git 'er done!", "Task me!", "Crush it!") with dev-culture and chaos-agent humor ("sudo make me do it", "git commit to something", "roll for initiative", "deploy yourself", "the dice abide", "chaos, but organized", "one task to rule them all", "spin the wheel of fate", "RNG, take the wheel", …). Keep it PG, keep it punchy.
- [ ] Commit — `feat: add randomizer button phrase pool`

---

### Task 3: Randomizer screen

**Files:**
- Create: `src/lib/ui/RandomizerView.svelte`
- Modify: `src/lib/ui/router.svelte.ts` (add route), `src/App.svelte` (render it)

**Route:** `{ name: 'randomizer'; listId?: string }` ⇄ `#/randomizer` / `#/randomizer/<listId>`.

**Behaviors:**
- On mount: draw immediately via `drawTask(app.state.tasks, settings, new Date(), Math.random, scope)` where scope = `{ listId: filterList, tagIds: filterTags, excludeIds: [...notNow] }`.
- Task card (`draw-card`): name, list, notes preview, tags, deadline + effective priority (flame if escalated), estimate.
- Buttons: `draw-accept` ("Accept — let's go") → `app.acceptTask` → navigate home. `draw-not-now` ("Not now") → add id to `notNow` set, redraw. `draw-not-today` ("Not today") → `app.sendNotToday(id)`, redraw. `back` ✕ → home, task untouched.
- Filters row: list `<select>` (`draw-filter-list`, empty option = all lists; preset + locked-off? no — preset from route listId but changeable) and tag chips (`draw-filter-tag-<id>`, multi-toggle). Changing any filter clears `notNow` (new pool, fresh session) and redraws.
- Empty state (`draw-empty`): if the unfiltered-but-snoozed pool is only empty because of `notNow` skips, show "you've skipped everything — reset skips?" (`draw-reset-skips`) which clears the set and redraws; otherwise "// pool empty — everything's done or snoozed until 4am" + home button.
- Priority tier of the drawn task is shown with its color ("drawn from: HIGH").

- [ ] Implement; `npm run check`; commit — `feat: randomizer screen with filters, not-now/not-today flow`

---

### Task 4: Home integration — big button + current task card + In Progress

**Files:**
- Modify: `src/lib/ui/Home.svelte`, `src/lib/ui/ListView.svelte` (header gains `list-randomize` 🎲 button → `#/randomizer/<id>`), `src/lib/ui/TaskEditor.svelte` ("make current" button + in-progress toggle), `src/lib/ui/router.svelte.ts` + `src/App.svelte` (route `{name:'inprogress'}` ⇄ `#/inprogress`)
- Create: `src/lib/ui/CurrentTaskCard.svelte`, `src/lib/ui/InProgressView.svelte`

**Behaviors:**
- Big button (`big-button`) sits above the sort row: full-width, tall, phrase from `nextPhrase()`; → `#/randomizer`. Phrase re-rolls each Home mount.
- `CurrentTaskCard` (when `state.currentTask` set, above the button): "CURRENT TASK" eyebrow, name (tap → its list view with editor open — pass via `navigate({name:'list', id})` then ListView auto-expands `currentTask.taskId`... simplest: card links to list view; editing from there), complete button (`current-complete`) → `completeTask` (clears current automatically per P2 store), not-today (`current-not-today`), clear (`current-clear`, subtle ✕). If the referenced task is missing/completed/deleted (e.g. restored db), card self-heals: clearCurrent.
- In Progress entry on Home (`inprogress-link`, shows count when > 0) → `InProgressView`: TaskRows of all open `inProgress` tasks (editor available; also an "unmark" affordance via editor toggle).
- TaskEditor additions: "make current" (`task-make-current`) and an in-progress toggle chip (`task-inprogress-toggle`).

- [ ] Implement; check; commit — `feat: big button, current task card, in-progress view`

---

### Task 5: E2E — the draw loop

**Files:**
- Create: `e2e/randomizer.spec.ts`

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

async function seed(page: import('@playwright/test').Page, names: string[]) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Pool');
  await page.getByTestId('new-list-input').press('Enter');
  for (const name of names) {
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-name-input').fill(name);
    await page.getByTestId('task-collapse').click();
  }
  await page.getByTestId('back').click();
}

test('draw → accept → current task card → complete', async ({ page }) => {
  await seed(page, ['alpha']);
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('alpha');
  await page.getByTestId('draw-accept').click();
  await expect(page.getByTestId('current-task-card')).toContainText('alpha');
  await page.reload(); // current task survives an app kill
  await expect(page.getByTestId('current-task-card')).toContainText('alpha');
  await page.getByTestId('current-complete').click();
  await expect(page.getByTestId('current-task-card')).toHaveCount(0);
  await page.getByTestId('completed-link').click();
  await expect(page.getByText('alpha')).toBeVisible();
});

test('not now cycles to a different task; exhausting pool offers reset', async ({ page }) => {
  await seed(page, ['one', 'two']);
  await page.getByTestId('big-button').click();
  const first = await page.getByTestId('draw-card').textContent();
  await page.getByTestId('draw-not-now').click();
  const second = await page.getByTestId('draw-card').textContent();
  expect(second).not.toBe(first); // guaranteed different
  await page.getByTestId('draw-not-now').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible();
  await page.getByTestId('draw-reset-skips').click();
  await expect(page.getByTestId('draw-card')).toBeVisible();
});

test('not today removes the task from the pool but not from its list', async ({ page }) => {
  await seed(page, ['snoozeme']);
  await page.getByTestId('big-button').click();
  await page.getByTestId('draw-not-today').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible(); // pool now empty (real snooze, no reset offer)
  await expect(page.getByTestId('draw-reset-skips')).toHaveCount(0);
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByText('snoozeme')).toBeVisible(); // still in the list view
});

test('in-progress preference: accepted-then-swapped task comes back first', async ({ page }) => {
  await seed(page, ['started', 'fresh']);
  // make "started" in progress via accept + clear
  await page.getByTestId(/^list-row-/).first().click();
  await page.getByText('started').click();
  await page.getByTestId('task-make-current').click();
  await page.getByTestId('current-clear').click(); // back on home after make-current
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('started'); // inProgress preferred deterministically
});
```

- [ ] Run both projects → green; full unit suite + check green; commit — `test: randomizer flow e2e`; push; watch CI; verify live URL; notify Ben (this is THE feature — worth a push notification if he's away).

---

## Self-Review Notes

- **Spec coverage:** big button w/ rotating phrases ✔ (juice deferred), draw within top tier + in-progress preference (domain, already tested) ✔, Accept/Not-Now/Not-Today ✔, filters ✔, session-only exclusions ✔, current task persistence ✔, manual make-current ✔, In Progress view ✔, list-scoped entry ✔.
- **Type consistency:** route union extended in one place (`router.svelte.ts`) and consumed via `{@const r}` narrowing in App.svelte; store methods match e2e testids' handlers.
- **Judgment calls:** "Not Today" also auto-redraws (spec: it removes from pool "until tomorrow" — the user is still mid-drawing-session); current card tap-to-edit routes to the list view rather than embedding a fourth editor instance; empty-state distinguishes skip-exhaustion (offers reset) from true emptiness.
