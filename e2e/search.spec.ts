import { expect, test, type Page } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'search flows on chromium');

async function reset(page: Page) {
  await page.goto('./');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('organizedchaos');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await page.getByTestId('new-list').waitFor();
}

async function addTask(page: Page, name: string, notes?: string) {
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill(name);
  if (notes) await page.getByTestId('task-notes-input').fill(notes);
  // Same hardening as features.spec's twin: let any re-sort settle, and
  // .last() past the ~220ms ghost editor a re-grouped row leaves behind.
  // (This helper's bare version cost a CI cycle on 2026-07-30.)
  await page.waitForTimeout(250);
  await page.getByTestId('task-collapse').last().click();
  // by name, not .first() — rows sort by priority, so position isn't insertion order
  const row = page.getByTestId(/^task-row-/).filter({ hasText: name }).first();
  return (await row.getAttribute('data-testid'))!.replace('task-row-', '');
}

test('finds open and completed tasks, with completed shown separately and dated', async ({ page }) => {
  await reset(page);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Errands');
  await page.getByTestId('new-list-input').press('Enter');

  await addTask(page, 'buy milk');
  await addTask(page, 'call the vet', 'ask about the milk allergy');
  const doneId = await addTask(page, 'return the milk frother');
  await page.getByTestId(`task-check-${doneId}`).click();
  await expect(page.getByTestId(`task-row-${doneId}`)).toHaveCount(0);
  await page.getByTestId('back').click();

  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('milk');

  // open matches, including one that only matches in its notes
  await expect(page.getByText('buy milk', { exact: true })).toBeVisible();
  await expect(page.getByText('call the vet', { exact: true })).toBeVisible();
  // completed match lives in its own dimmer block, with a completion date
  const completed = page.getByTestId('search-completed');
  await expect(completed).toContainText('return the milk frother');
  await expect(completed).toContainText('✓');
});

test('narrowing the query with a second term filters further; no match says so', async ({ page }) => {
  await reset(page);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Errands');
  await page.getByTestId('new-list-input').press('Enter');
  await addTask(page, 'buy milk');
  await addTask(page, 'buy bread');
  await page.getByTestId('back').click();

  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('buy');
  await expect(page.getByText('buy milk', { exact: true })).toBeVisible();
  await expect(page.getByText('buy bread', { exact: true })).toBeVisible();

  await page.getByTestId('search-input').fill('milk buy'); // order shouldn't matter
  await expect(page.getByText('buy milk', { exact: true })).toBeVisible();
  await expect(page.getByText('buy bread', { exact: true })).toHaveCount(0);

  await page.getByTestId('search-input').fill('kumquat');
  await expect(page.getByTestId('search-empty')).toBeVisible();
});

test('a fresh search starts blank, but refocusing an open search keeps it', async ({ page }) => {
  await reset(page);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Errands');
  await page.getByTestId('new-list-input').press('Enter');
  await addTask(page, 'buy milk');
  await page.getByTestId('back').click();

  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('milk');
  await expect(page.getByText('buy milk', { exact: true })).toBeVisible();

  // Cmd/Ctrl+K on the search screen refocuses — it must not eat the query.
  await page.keyboard.press('ControlOrMeta+k');
  await expect(page.getByTestId('search-input')).toHaveValue('milk');

  // Leaving and tapping the bar again is a NEW search: blank, not last time's text.
  await page.getByTestId('back').click();
  await page.getByTestId('search-entry').click();
  await expect(page.getByTestId('search-input')).toHaveValue('');

  // The "/" shortcut from home starts fresh too.
  await page.getByTestId('search-input').fill('bread');
  await page.getByTestId('back').click();
  await page.keyboard.press('/');
  await expect(page.getByTestId('search-input')).toHaveValue('');
});

test('the "/" shortcut opens search, and results are editable in place', async ({ page }) => {
  await reset(page);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Errands');
  await page.getByTestId('new-list-input').press('Enter');
  await addTask(page, 'water the ferns');
  await page.getByTestId('back').click();

  await page.keyboard.press('/');
  await expect(page.getByTestId('search-input')).toBeVisible();
  await page.getByTestId('search-input').fill('ferns');

  // opening a result expands the real editor
  await page.getByText('water the ferns', { exact: true }).click();
  await page.getByTestId('priority-high').click();
  await expect(page.getByTestId('task-name-input')).toHaveValue('water the ferns');
});
