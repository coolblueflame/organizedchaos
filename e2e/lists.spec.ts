import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('./');
  // Fresh database per test. Dexie closes its connection on versionchange,
  // so the delete resolves instead of deadlocking on the open handle.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('organizedchaos');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await page.getByTestId('new-list').waitFor();
});

async function makeList(page: import('@playwright/test').Page, title: string) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill(title);
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').waitFor(); // navigated into the list view
}

async function firstTaskId(page: import('@playwright/test').Page) {
  const row = page.getByTestId(/^task-row-/).first();
  return (await row.getAttribute('data-testid'))!.replace('task-row-', '');
}

test('create list, add + edit task, complete it, find it in Completed, restore it', async ({ page }) => {
  await makeList(page, 'Chores');

  await page.getByTestId('new-task').click();
  // The row title IS the name field while expanded — collapse to read it as text.
  await page.getByTestId('task-name-input').fill('water the plants');
  await page.getByTestId('task-collapse').click();

  const id = await firstTaskId(page);
  await expect(page.getByTestId(`task-row-${id}`)).toContainText('water the plants');

  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);

  await page.getByTestId('back').click();
  await page.getByTestId('completed-link').click();
  await expect(page.getByTestId(`task-row-${id}`)).toContainText('water the plants');
  await page.getByTestId(`task-restore-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
});

test('delete a task and undo it', async ({ page }) => {
  await makeList(page, 'Trash test');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('doomed');
  await page.getByTestId('task-collapse').click();

  const id = await firstTaskId(page);
  await page.getByTestId(`task-delete-${id}`).click(); // arm
  await page.getByTestId(`task-delete-${id}`).click(); // commit
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
  await page.getByTestId('undo-toast').getByRole('button', { name: /undo/i }).click();
  await expect(page.getByTestId(`task-row-${id}`)).toContainText('doomed');
});

test('sort views group across lists', async ({ page }) => {
  await makeList(page, 'A');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('dated');
  await page.getByTestId('task-deadline-input').fill('2030-01-01');
  await page.getByTestId('back').click();

  await makeList(page, 'B');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('undated');
  await page.getByTestId('task-name-input').blur();
  await page.getByTestId('back').click();

  await page.getByTestId('sort-date').click();
  await expect(page.getByText('2030-01-01')).toBeVisible();
  await expect(page.getByText('No deadline')).toBeVisible();
  await expect(page.getByText('dated', { exact: true })).toBeVisible();
  await expect(page.getByText('undated', { exact: true })).toBeVisible();
});

test('rapid entry: Enter chains a new task, Esc drops the untouched one', async ({ page }) => {
  await makeList(page, 'Rapid');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('first');
  await page.getByTestId('task-name-input').press('Enter');

  // chained straight into a fresh, empty, focused field
  await expect(page.getByTestId('task-name-input')).toHaveValue('');
  await page.getByTestId('task-name-input').fill('second');
  await page.getByTestId('task-name-input').press('Enter');
  await expect(page.getByTestId('task-name-input')).toHaveValue('');

  // the untouched third evaporates
  await page.getByTestId('task-name-input').press('Escape');
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(2);
  await expect(page.getByText('first', { exact: true })).toBeVisible();
  await expect(page.getByText('second', { exact: true })).toBeVisible();
});

test('rapid entry: Enter on an empty name just ends the chain', async ({ page }) => {
  await makeList(page, 'Enterless');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').press('Enter');
  await expect(page.getByTestId('task-name-input')).toHaveCount(0); // editor closed
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(0);      // nothing left behind
});

test('rapid entry: navigating away drops untouched tasks, keeps typed ones', async ({ page }) => {
  await makeList(page, 'Leaver');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('kept');
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('new-task').click(); // left untouched
  await page.getByTestId('back').click();

  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(1);
  await expect(page.getByText('kept', { exact: true })).toBeVisible();
});

test('clicking outside and Escape both collapse; a named task survives, an empty one does not', async ({ page }) => {
  await makeList(page, 'Outside');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('typed something');
  await page.locator('h1').click(); // click well outside the row
  await expect(page.getByTestId('task-name-input')).toHaveCount(0); // collapsed
  await expect(page.getByText('typed something', { exact: true })).toBeVisible(); // kept

  await page.getByTestId('new-task').click(); // fresh, empty
  await page.locator('h1').click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(1); // blank one discarded

  // Escape collapses an existing task from anywhere in the editor
  await page.getByText('typed something', { exact: true }).click();
  await page.getByTestId('task-notes-input').click();
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-name-input')).toHaveCount(0);
  await expect(page.getByText('typed something', { exact: true })).toBeVisible();
});

test('undo brings back a completed task via keyboard', async ({ page }) => {
  await makeList(page, 'Undoable');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('finish me');
  await page.getByTestId('task-collapse').click();
  const id = await firstTaskId(page);

  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId(`task-row-${id}`)).toContainText('finish me');
});

test('an immediate undo brings the task back with an EMPTY checkbox', async ({ page }) => {
  await makeList(page, 'Undoable');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('changed my mind');
  await page.getByTestId('task-collapse').click();
  const id = await firstTaskId(page);

  // Undo the moment the toast lands — the row's leave animation is still
  // playing, so Svelte cancels the outro and REVIVES the same component
  // instance rather than making a fresh one. The checkbox must not stay
  // wearing the completion tick it picked up on the way out.
  await page.getByTestId(`task-check-${id}`).click();
  await page.getByTestId('undo-toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId(`task-row-${id}`)).toContainText('changed my mind');
  await expect(page.getByTestId(`task-check-${id}`)).not.toHaveClass(/completing/);
  // And it must be completable again — the guard flag can't be stuck either.
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
});

test("a ritual's checkbox lets go after completing — and after an undo", async ({ page }) => {
  await makeList(page, 'Life');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('eat lunch');
  await page.getByTestId('task-ritual-row').click();
  await page.getByTestId('ritual-from').fill('00:00');
  await page.getByTestId('ritual-to').fill('23:59');
  await page.getByTestId('ritual-save').click();
  await page.getByTestId('task-collapse').click();
  const id = await firstTaskId(page);

  // A ritual's row NEVER leaves the list on completion — it has to exist
  // tomorrow — so this is the one place the checkbox outlives its own tick.
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toBeVisible();
  await expect(page.getByTestId(`task-check-${id}`)).not.toHaveClass(/completing/);

  await expect(page.getByTestId(`ritual-mark-${id}`)).toHaveClass(/ritual-done/);

  // Undoing must hand back an empty checkbox AND an undone ritual — the mark
  // returns to due, not a lingering "done today".
  await page.getByTestId('undo-toast').getByRole('button', { name: 'Undo' }).click();
  await expect(page.getByTestId(`task-check-${id}`)).not.toHaveClass(/completing/);
  await expect(page.getByTestId(`ritual-mark-${id}`)).toHaveClass(/ritual-due/);

  // And completing again must genuinely take: the mark goes back to done.
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`ritual-mark-${id}`)).toHaveClass(/ritual-done/);
});

test('tapping the list title renames it in place', async ({ page }) => {
  await makeList(page, 'Errnads'); // typo, on purpose — the whole use case
  await page.getByTestId('list-title').click();
  await expect(page.getByTestId('list-title-input')).toHaveValue('Errnads');
  await page.getByTestId('list-title-input').fill('Errands');
  await page.getByTestId('list-title-input').press('Enter');
  await expect(page.getByTestId('list-title')).toContainText('Errands');

  // Escape backs out without saving.
  await page.getByTestId('list-title').click();
  await page.getByTestId('list-title-input').fill('Wrong Turn');
  await page.getByTestId('list-title-input').press('Escape');
  await expect(page.getByTestId('list-title')).toContainText('Errands');

  // The new name is real data — home shows it too.
  await page.getByTestId('back').click();
  await expect(page.getByTestId(/^list-row-/).first()).toContainText('Errands');
});

test('deleting a task takes two taps, and undo restores it', async ({ page }) => {
  await makeList(page, 'Twice');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('fragile');
  await page.getByTestId('task-collapse').click();
  const id = await firstTaskId(page);

  await page.getByTestId(`task-delete-${id}`).click();            // arms only
  await expect(page.getByTestId(`task-delete-${id}`)).toContainText('sure?');
  await expect(page.getByTestId(`task-row-${id}`)).toBeVisible();
  await page.getByTestId(`task-delete-${id}`).click();            // commits
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);

  await page.getByTestId('undo-toast').getByRole('button', { name: /undo/i }).click();
  await expect(page.getByTestId(`task-row-${id}`)).toContainText('fragile');
});

test('per-list sort mode is remembered', async ({ page }) => {
  await makeList(page, 'Sorty');
  await expect(page.getByTestId('list-sort')).toContainText('priority');
  await page.getByTestId('list-sort').click();
  await expect(page.getByTestId('list-sort')).toContainText('date');
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId('list-sort')).toContainText('date');
});

test('copies today\'s wins as a dash-bulleted list', async ({ page, context, browserName }) => {
  test.skip(browserName !== 'chromium', 'clipboard permissions are chromium-only here');
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await makeList(page, 'Wins');

  for (const name of ['Mow the lawn', 'Book dentist']) {
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-name-input').fill(name);
    await page.waitForTimeout(250);
    await page.getByTestId('task-collapse').last().click();
  }
  // Complete them oldest-first so the copied order is predictable.
  for (const name of ['Mow the lawn', 'Book dentist']) {
    const row = page.getByTestId(/^task-row-/).filter({ hasText: name }).first();
    const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
    await page.getByTestId(`task-check-${id}`).click();
    await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
  }

  await page.getByTestId('back').click();
  await page.getByTestId('completed-link').click();
  await expect(page.getByTestId('copy-wins')).toContainText('2 wins');

  await page.getByTestId('copy-wins').click();
  await expect(page.getByTestId('copy-wins')).toContainText('copied');
  const clip = await page.evaluate(() => navigator.clipboard.readText());
  expect(clip).toBe('- Mow the lawn\n- Book dentist');
});

test('offers nothing to copy on a day with no completions', async ({ page }) => {
  await makeList(page, 'Quiet');
  await page.getByTestId('back').click();
  await page.getByTestId('completed-link').click();
  await expect(page.getByTestId('copy-wins')).toHaveCount(0);
});
