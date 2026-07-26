# Phase 2: Lists & Views Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app becomes a usable todo manager: home screen with grouped lists, list views with inline task creation and an expanding editor, one-tap checkbox completion and delete-with-undo everywhere, the three global sort views, and a Completed screen with restore.

**Architecture:** A Svelte 5 runes store (`AppStore`) holds an in-memory mirror of `AppState`; every mutation goes through `Repo` (Phase 1) then patches the mirror — no full reloads. A dependency-free hash router switches four screens. All grouping/sorting logic lives in a new pure-domain module `views.ts` (fully unit-tested); components stay thin.

**Tech Stack:** unchanged from Phase 1 (no new dependencies).

**Spec:** `docs/superpowers/specs/2026-07-26-organized-chaos-design.md` §6 (screens), minus: randomizer/current-task UI (Phase 3), recurrence editor (Phase 4), juice (Phase 5), stats counters/graph (Phase 8). The task editor shows a disabled "repeat" row as a Phase-4 placeholder.

## Global Constraints

(Phase 1 globals still apply: strict TS, domain purity, theme tokens only, tombstone deletes, flat bash, commit trailer.)

- No new npm dependencies — router and store are hand-rolled.
- Every mutating UI action must round-trip through `Repo` (never mutate the mirror alone).
- Deleting a task/list shows a 5s undo toast; undo restores by flipping the tombstone back (`deleted: false`) via `Repo` update.
- Sort views duplicate multi-tag tasks per tag section and always show an "Untagged" terminal section (spec §6).
- Per-list sort memory persists via `Repo.updateList(id, { sortMode })`.
- All interactive elements get stable `data-testid` attributes; e2e selectors use them.
- Mobile-first layout (primary target is an iPhone); desktop just gets a centered max-width column.

---

### Task 1: View grouping logic (pure domain)

**Files:**
- Create: `src/lib/domain/views.ts`
- Test: `src/lib/domain/views.test.ts`

**Interfaces:**
- Consumes: `Task`, `Tag`, `Settings`, `Priority`, `PRIORITIES`, `priorityRank` (P1); `effectivePriority` (P1); `daysUntilDeadline`, `appDayKey` (P1).
- Produces:

```ts
export interface TaskGroup { key: string; label: string; tasks: Task[] }
/** Overdue → per-date ascending → 'No deadline' last; sub-sorted by effective priority desc. */
export function groupByDate(tasks: Task[], settings: Settings, now: Date): TaskGroup[];
/** Max → … → Someday by effective priority; sub-sorted by deadline asc, deadline-less last. */
export function groupByPriority(tasks: Task[], settings: Settings, now: Date): TaskGroup[];
/** Alphabetical tag sections (multi-tag tasks duplicated), 'Untagged' last; sub-sorted by effective priority desc. */
export function groupByTag(tasks: Task[], tags: Tag[], settings: Settings, now: Date): TaskGroup[];
/** Completed tasks bucketed by completion app-day, newest day first, newest completion first within. */
export function groupCompleted(tasks: Task[], rolloverHour: number): TaskGroup[];
/** Open (not completed) tasks only — the input every list/sort view starts from. */
export function openTasks(tasks: Task[]): Task[];
```

Group keys/labels: date groups use `key = 'overdue' | 'YYYY-MM-DD' | 'none'` with labels `'Overdue'`, the date key, `'No deadline'`; priority groups use the priority literal as key and capitalized label (`'Max'`…`'Someday'`); tag groups use `key = tagId | 'untagged'`, label = tag name / `'Untagged'`; completed groups use the app-day key as both.

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/views.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Priority, type Tag, type Task } from './types';
import { groupByDate, groupByPriority, groupByTag, groupCompleted, openTasks } from './views';

const now = new Date('2026-07-15T12:00:00');
let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'L1', name: `task-${n}`, notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});
const tag = (id: string, name: string): Tag =>
  ({ id, name, colorIndex: 0, createdAt: 0, updatedAt: 0, deleted: false });

describe('openTasks', () => {
  it('drops completed and deleted', () => {
    const open = task({ priority: 'low' });
    const done = task({ priority: 'low', completedAt: 5 });
    const gone = task({ priority: 'low', deleted: true });
    expect(openTasks([open, done, gone])).toEqual([open]);
  });
});

describe('groupByDate', () => {
  it('orders Overdue, dates ascending, No deadline; sub-sorts by effective priority', () => {
    const late = task({ priority: 'low', deadline: '2026-07-10' });
    const todayHi = task({ priority: 'max', deadline: '2026-07-15' });
    const todayLo = task({ priority: 'someday', deadline: '2026-07-15' });
    const soon = task({ priority: 'low', deadline: '2026-07-20' });
    const never = task({ priority: 'high' });
    const groups = groupByDate([soon, never, todayLo, late, todayHi], DEFAULT_SETTINGS, now);
    expect(groups.map((g) => g.key)).toEqual(['overdue', '2026-07-15', '2026-07-20', 'none']);
    expect(groups[1]!.tasks.map((t) => t.id)).toEqual([todayHi.id, todayLo.id]);
  });
});

describe('groupByPriority', () => {
  it('uses EFFECTIVE priority and sub-sorts by deadline', () => {
    const escalated = task({ priority: 'low', deadline: '2026-07-14' }); // overdue → max
    const manualMaxLater = task({ priority: 'max', deadline: '2026-07-20' });
    const manualMaxNoDl = task({ priority: 'max' });
    const medium = task({ priority: 'medium' });
    const groups = groupByPriority([medium, manualMaxNoDl, manualMaxLater, escalated], DEFAULT_SETTINGS, now);
    expect(groups.map((g) => g.key)).toEqual(['max', 'medium']);
    expect(groups[0]!.tasks.map((t) => t.id))
      .toEqual([escalated.id, manualMaxLater.id, manualMaxNoDl.id]); // deadline asc, none last
    expect(groups[0]!.label).toBe('Max');
  });
});

describe('groupByTag', () => {
  it('alphabetical sections, multi-tag duplication, Untagged last', () => {
    const zebra = tag('z', 'zebra');
    const alpha = tag('a', 'alpha');
    const both = task({ priority: 'high', tagIds: ['z', 'a'] });
    const onlyZ = task({ priority: 'low', tagIds: ['z'] });
    const none = task({ priority: 'low' });
    const groups = groupByTag([both, onlyZ, none], [zebra, alpha], DEFAULT_SETTINGS, now);
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'zebra', 'Untagged']);
    expect(groups[1]!.tasks.map((t) => t.id)).toEqual([both.id, onlyZ.id]); // priority desc
    expect(groups[0]!.tasks.map((t) => t.id)).toEqual([both.id]); // duplicated
  });

  it('omits empty tag sections', () => {
    const unused = tag('u', 'unused');
    const plain = task({ priority: 'low' });
    const groups = groupByTag([plain], [unused], DEFAULT_SETTINGS, now);
    expect(groups.map((g) => g.key)).toEqual(['untagged']);
  });
});

describe('groupCompleted', () => {
  it('buckets by completion app-day (4am rule), newest first', () => {
    const lateNight = task({ priority: 'low', completedAt: new Date('2026-07-15T02:00:00').getTime() });
    const morning = task({ priority: 'low', completedAt: new Date('2026-07-15T09:00:00').getTime() });
    const older = task({ priority: 'low', completedAt: new Date('2026-07-01T12:00:00').getTime() });
    const groups = groupCompleted([older, lateNight, morning], 4);
    expect(groups.map((g) => g.key)).toEqual(['2026-07-15', '2026-07-14', '2026-07-01']);
    expect(groups[1]!.tasks.map((t) => t.id)).toEqual([lateNight.id]); // 2am → previous app-day
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/domain/views.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/views.ts
import { effectivePriority } from './priority';
import { appDayKey, daysUntilDeadline } from './time';
import { PRIORITIES, priorityRank, type Priority, type Settings, type Tag, type Task } from './types';

export interface TaskGroup { key: string; label: string; tasks: Task[] }

export function openTasks(tasks: Task[]): Task[] {
  return tasks.filter((t) => !t.deleted && t.completedAt === undefined);
}

const byEffectiveDesc = (settings: Settings, now: Date) => (a: Task, b: Task) =>
  priorityRank(effectivePriority(b, settings, now)) - priorityRank(effectivePriority(a, settings, now));

/** deadline ascending, deadline-less last, then stable */
const byDeadlineAsc = (a: Task, b: Task) => {
  if (a.deadline === b.deadline) return 0;
  if (a.deadline === undefined) return 1;
  if (b.deadline === undefined) return -1;
  return a.deadline < b.deadline ? -1 : 1;
};

export function groupByDate(tasks: Task[], settings: Settings, now: Date): TaskGroup[] {
  const open = openTasks(tasks);
  const overdue: Task[] = [];
  const dated = new Map<string, Task[]>();
  const none: Task[] = [];
  for (const t of open) {
    if (t.deadline === undefined) { none.push(t); continue; }
    if (daysUntilDeadline(t.deadline, now, settings.rolloverHour) < 0) { overdue.push(t); continue; }
    const bucket = dated.get(t.deadline) ?? [];
    bucket.push(t);
    dated.set(t.deadline, bucket);
  }
  const sub = byEffectiveDesc(settings, now);
  const groups: TaskGroup[] = [];
  if (overdue.length) groups.push({ key: 'overdue', label: 'Overdue', tasks: overdue.sort(sub) });
  for (const key of [...dated.keys()].sort()) {
    groups.push({ key, label: key, tasks: dated.get(key)!.sort(sub) });
  }
  if (none.length) groups.push({ key: 'none', label: 'No deadline', tasks: none.sort(sub) });
  return groups;
}

const PRIORITY_LABELS: Record<Priority, string> =
  { someday: 'Someday', low: 'Low', medium: 'Medium', high: 'High', max: 'Max' };

export function groupByPriority(tasks: Task[], settings: Settings, now: Date): TaskGroup[] {
  const open = openTasks(tasks);
  const groups: TaskGroup[] = [];
  for (const p of [...PRIORITIES].reverse()) {
    const bucket = open.filter((t) => effectivePriority(t, settings, now) === p).sort(byDeadlineAsc);
    if (bucket.length) groups.push({ key: p, label: PRIORITY_LABELS[p], tasks: bucket });
  }
  return groups;
}

export function groupByTag(tasks: Task[], tags: Tag[], settings: Settings, now: Date): TaskGroup[] {
  const open = openTasks(tasks);
  const sub = byEffectiveDesc(settings, now);
  const liveTags = tags.filter((t) => !t.deleted).sort((a, b) => a.name.localeCompare(b.name));
  const groups: TaskGroup[] = [];
  for (const tag of liveTags) {
    const bucket = open.filter((t) => t.tagIds.includes(tag.id)).sort(sub);
    if (bucket.length) groups.push({ key: tag.id, label: tag.name, tasks: bucket });
  }
  const untagged = open.filter((t) => t.tagIds.length === 0).sort(sub);
  if (untagged.length) groups.push({ key: 'untagged', label: 'Untagged', tasks: untagged });
  return groups;
}

export function groupCompleted(tasks: Task[], rolloverHour: number): TaskGroup[] {
  const done = tasks
    .filter((t) => !t.deleted && t.completedAt !== undefined)
    .sort((a, b) => b.completedAt! - a.completedAt!);
  const buckets = new Map<string, Task[]>();
  for (const t of done) {
    const key = appDayKey(new Date(t.completedAt!), rolloverHour);
    const bucket = buckets.get(key) ?? [];
    bucket.push(t);
    buckets.set(key, bucket);
  }
  return [...buckets.entries()].map(([key, ts]) => ({ key, label: key, tasks: ts }));
}
```

- [ ] **Step 4: Run to verify pass**, then full suite `npm test` → all green.
- [ ] **Step 5: Commit** — `feat: add view grouping logic (date/priority/tag/completed)`

---

### Task 2: App store (runes state layer)

**Files:**
- Create: `src/lib/state/app.svelte.ts`
- Test: `src/lib/state/app.test.ts` (runs in node; runes compile via vitest's svelte transform — if `.svelte.ts` runes don't compile under the node environment, wrap state in a plain object + manual subscribe, keep the same API)

**Interfaces:**
- Consumes: `Repo`, `openDb`, `AppState` (P1); domain types.
- Produces (every screen talks ONLY to this):

```ts
export class AppStore {
  state: AppState;                       // $state mirror, readonly by convention
  ready: boolean;                       // true once init() has loaded
  init(dbName?: string): Promise<void>; // open db, loadState, run recurrence sweep (no-op for now)
  // lists
  addList(title: string, areaGroup?: string): Promise<List>;
  renameList(id: string, title: string): Promise<void>;
  regroupList(id: string, areaGroup: string | undefined): Promise<void>;
  setListSort(id: string, sortMode: SortMode): Promise<void>;
  removeList(id: string): Promise<void>;            // tombstones list + its open tasks
  restoreList(id: string, taskIds: string[]): Promise<void>; // undo partner
  // tasks
  addTask(listId: string): Promise<Task>;           // blank medium-priority task, editor opens on it
  patchTask(id: string, patch: Partial<Task>): Promise<void>;
  completeTask(id: string): Promise<void>;          // stamps completedAt = Date.now()
  uncompleteTask(id: string): Promise<void>;        // clears completedAt
  removeTask(id: string): Promise<void>;
  restoreTask(id: string): Promise<void>;
  // tags
  addTag(name: string, colorIndex: number): Promise<Tag>;
}
export const app: AppStore;             // module singleton the UI imports
```

Behaviors that MUST hold (tests): every mutation persists through Repo AND patches `state` so a fresh `Repo.loadState()` agrees with the mirror; `removeList` tombstones its open tasks and returns—via `restoreList`—exactly those tasks on undo; `completeTask`/`uncompleteTask` round-trip; `addTask` defaults `priority: 'medium'`, empty name/notes.

- [ ] **Step 1: Write failing tests** for the behaviors above (fresh db name per test, like `repo.test.ts`; assert both `app.state` and a re-read `loadState()`).
- [ ] **Step 2: Verify fail.**
- [ ] **Step 3: Implement** — thin wrapper: call repo, then mutate the `$state` mirror in place (push/splice/assign). `removeList(id)`: collect open task ids in that list first, tombstone each + the list, remember nothing in the store (the undo toast holds the ids).
- [ ] **Step 4: Verify pass + full suite.**
- [ ] **Step 5: Commit** — `feat: add runes app store bridging repo and UI`

---

### Task 3: Hash router + screen shells

**Files:**
- Create: `src/lib/ui/router.svelte.ts`
- Modify: `src/App.svelte` (becomes the router shell), `src/main.ts` (call `app.init()` before mount... keep mount immediate and show a loading state — simpler: App awaits `app.ready`)
- Create: `src/lib/ui/Home.svelte`, `src/lib/ui/ListView.svelte`, `src/lib/ui/SortView.svelte`, `src/lib/ui/CompletedView.svelte` (skeletons that render their name + a back link; fleshed out in later tasks)

**Interfaces:**
- Produces:

```ts
// router.svelte.ts — hash-based, zero deps
export type Route =
  | { name: 'home' }
  | { name: 'list'; id: string }
  | { name: 'sort'; mode: 'date' | 'priority' | 'tag' }
  | { name: 'completed' };
export const router: { current: Route };  // $state, synced to location.hash
export function navigate(r: Route): void; // sets location.hash ('#/', '#/list/<id>', '#/sort/date', '#/completed')
```

- [ ] **Step 1:** Implement router (parse `location.hash` on `hashchange` + load; unknown → home).
- [ ] **Step 2:** App.svelte: `{#if !app.ready}` boot splash (reuse Phase-1 wordmark) `{:else}` switch on `router.current.name` rendering the four screens. Remove the Phase-1 placeholder content into Home.svelte's header.
- [ ] **Step 3:** `npm run check` + existing e2e still passes (update smoke selectors if the wordmark moved — it should still render on Home).
- [ ] **Step 4: Commit** — `feat: add hash router and screen shells`

---

### Task 4: Home screen (lists + navigation)

**Files:**
- Modify: `src/lib/ui/Home.svelte`
- Create: `src/lib/ui/NewListRow.svelte`

**Behaviors (all `data-testid`ed):**
- Wordmark header (compact), then sort-view row: three buttons `sort-date` / `sort-priority` / `sort-tag` → navigate to SortView.
- Lists grouped under `areaGroup` headers (ungrouped lists first, no header); each row (`list-row-<id>`) shows title + open-task count; tap → ListView. Long-press/⋯ button opens rename / regroup / delete (delete confirms, then undo toast).
- `new-list` row: inline text input appears on tap, Enter creates + navigates into the list.
- `completed-link` entry at the bottom → CompletedView. (Randomizer button, current task card, stats land in Phases 3/8 — leave a clearly-marked placeholder block.)

- [ ] Implement, verify in dev server + `npm run check`, then **e2e** (Task 8 collects them), commit — `feat: home screen with grouped lists, list CRUD entry points`

---

### Task 5: List view + task rows + checkbox/delete

**Files:**
- Modify: `src/lib/ui/ListView.svelte`
- Create: `src/lib/ui/TaskRow.svelte`, `src/lib/ui/UndoToast.svelte`

**Behaviors:**
- Header: back, list title (tap to rename inline), sort toggle cycling priority→date→tag (persists via `setListSort`, initial from `list.sortMode`).
- Body: `TaskGroup[]` from `views.ts` per the active sort; group headers; `TaskRow` per task: checkbox (`task-check-<id>`), name (+ dim notes first line), tag chips (colored dots), deadline badge (red when overdue), priority glyph with escalation flame (`isEscalated`).
- Checkbox → `completeTask` (row animates out — simple CSS fade/collapse now, real juice in Phase 5).
- Delete: hover/⋯ reveal on desktop, swipe-left on touch (`task-delete-<id>`) → `removeTask` + `UndoToast` ("Task deleted — Undo", 5s, `undo-toast` testid) → `restoreTask`.
- `new-task` button → `addTask(listId)` → row appears with the editor (Task 6) expanded, name focused.
- UndoToast is a singleton mounted in App.svelte with a small store API: `toast.show(label, onUndo)`.

- [ ] Implement, verify manually + check, commit — `feat: list view with sorted groups, complete/delete/undo`

---

### Task 6: Task editor (expanding row)

**Files:**
- Create: `src/lib/ui/TaskEditor.svelte`, `src/lib/ui/TagPicker.svelte`, `src/lib/ui/PrioritySelect.svelte`
- Modify: `src/lib/ui/TaskRow.svelte` (tap row body ⇄ expand/collapse editor)

**Behaviors:**
- Unlabeled name input (top, `task-name-input`), unlabeled notes textarea below (`task-notes-input`) — both save on blur/debounce via `patchTask`.
- `PrioritySelect`: five segmented options colored by tier (someday=dim, low=blue, medium=green, high=orange, max=magenta).
- `TagPicker`: existing tags as toggle chips + "new tag" input with 16-color swatch grid (colors from a `TAG_COLORS` const of CSS var names in `src/lib/ui/tagColors.ts` — create it here).
- Deadline: `<input type="date">` (`task-deadline-input`), clearable. Estimate: number input, hours, step 0.5 (`task-estimate-input`).
- Meta line: "created <date>" (+ "completed <date>" when set). Buttons: delete (same undo path), collapse. Disabled "repeat" row placeholder labeled "recurring — coming in Phase 4".
- `addTask` flow: ListView tracks `editingTaskId`; newly added task renders expanded with name focused.

- [ ] Implement, verify manually + check, commit — `feat: expanding task editor with tags, deadline, estimate`

---

### Task 7: Sort views + Completed view

**Files:**
- Modify: `src/lib/ui/SortView.svelte`, `src/lib/ui/CompletedView.svelte`

**Behaviors:**
- SortView: header with back + title ("By Date/Priority/Tag"); body = `groupByDate/Priority/Tag` over ALL open tasks; rows are the same `TaskRow` (checkbox/delete/editor all work) plus a dim list-name suffix; tag view renders the same task in multiple sections (key rows by `group.key + task.id`).
- CompletedView: `groupCompleted` day sections (label today/yesterday nicely, else the date); rows show name struck-through + completion time; `task-restore-<id>` button → `uncompleteTask`; delete also available.

- [ ] Implement, verify manually + check, commit — `feat: global sort views and completed screen with restore`

---

### Task 8: E2E flows + phase gate

**Files:**
- Create: `e2e/lists.spec.ts`
- Modify: `e2e/smoke.spec.ts` only if Home moved the wordmark heading.

**Test code (complete):**

```ts
import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  await page.evaluate(() => indexedDB.deleteDatabase('organizedchaos'));
  await page.reload();
});

test('create list, add + edit task, complete it, find it in Completed, restore it', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Chores');
  await page.getByTestId('new-list-input').press('Enter');

  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('water the plants');
  await page.getByTestId('task-name-input').blur();

  const row = page.getByTestId(/task-row-/).first();
  await expect(row).toContainText('water the plants');

  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);

  await page.getByTestId('back').click();
  await page.getByTestId('completed-link').click();
  await expect(page.getByTestId(`task-row-${id}`)).toContainText('water the plants');
  await page.getByTestId(`task-restore-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
});

test('delete a task and undo it', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Trash test');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('doomed');
  await page.getByTestId('task-name-input').blur();

  const row = page.getByTestId(/task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-delete-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
  await page.getByTestId('undo-toast').getByRole('button', { name: /undo/i }).click();
  await expect(page.getByTestId(`task-row-${id}`)).toContainText('doomed');
});

test('sort views group across lists', async ({ page }) => {
  // one task with a deadline in list A, one without in list B
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('A');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('dated');
  await page.getByTestId('task-deadline-input').fill('2030-01-01');
  await page.getByTestId('back').click();

  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('B');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('undated');
  await page.getByTestId('back').click();

  await page.getByTestId('sort-date').click();
  await expect(page.getByText('2030-01-01')).toBeVisible();
  await expect(page.getByText('No deadline')).toBeVisible();
  await expect(page.getByText('dated')).toBeVisible();
  await expect(page.getByText('undated')).toBeVisible();
});
```

- [ ] **Steps:** run e2e (both projects) → fix until green; `npm run check` + `npm test` green; commit — `test: add list/task flow e2e coverage`; push; watch CI green; verify live URL updated (`curl -sI`, then spot-check by loading the page).
- [ ] **Phase gate:** run the `verify` skill flow (drive the deployed app once via Playwright against the live URL if practical, else local preview), update memory + `docs/superpowers/plans/` checkboxes, notify Ben with what's now testable on his phone.

---

## Self-Review Notes

- **Spec §6 coverage in-phase:** home lists+grouping+new-list+completed-link ✔ (randomizer button/current-task/stats deliberately deferred with visible placeholder); list view sort-memory/checkbox/delete/new-todo-expanded ✔; editor fields minus recurrence ✔ (placeholder row); three sort views incl. multi-tag duplication + Untagged ✔; completed grouped + restore ✔; delete-with-undo global constraint ✔.
- **Type consistency:** `TaskGroup` produced by all four groupers and consumed by ListView/SortView/CompletedView; store API names match usage in Tasks 4–7; `restoreList(id, taskIds)` signature matches the undo-toast closure described in Task 4.
- **Judgment calls:** list deletion undo holds task ids in the toast closure (not persisted) — acceptable, 5s window; sort-view rows reuse TaskRow so completion/deletion behave identically everywhere; `.svelte.ts` runes-in-vitest risk flagged in Task 2 with a fallback.
