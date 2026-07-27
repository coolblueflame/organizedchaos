import { expect, test, type Page } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'quick add flows on chromium');

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

async function makeList(page: Page, title: string) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill(title);
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').waitFor();
  await page.getByTestId('back').click();
}

test('captures several tasks in a row without leaving home', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Inbox');

  await page.getByTestId('quick-add-open').click();
  await page.getByTestId('quick-add-name').fill('first thing');
  await page.getByTestId('quick-add-name').press('Enter');

  // still on quick add, fresh empty field, counter ticked
  await expect(page.getByTestId('quick-add')).toContainText('1 added');
  await expect(page.getByTestId('quick-add-name')).toHaveValue('');

  await page.getByTestId('quick-add-name').fill('second thing');
  await page.getByTestId('quick-add-another').click();
  await expect(page.getByTestId('quick-add')).toContainText('2 added');

  // an empty one ends the session and leaves nothing behind
  await page.getByTestId('quick-add-name').press('Enter');
  await expect(page.getByTestId('quick-add')).toHaveCount(0);
  await expect(page.getByTestId('stats-strip')).toBeVisible(); // back on home

  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(2);
  await expect(page.getByText('first thing', { exact: true })).toBeVisible();
  await expect(page.getByText('second thing', { exact: true })).toBeVisible();
});

test('closing without typing leaves no phantom task', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Inbox');

  await page.getByTestId('quick-add-open').click();
  await page.getByTestId('quick-add-done').click();
  await expect(page.getByTestId('quick-add')).toHaveCount(0);

  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(0);
});

test('escape closes it, and details set in the sheet are kept', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Inbox');

  await page.getByTestId('quick-add-open').click();
  await page.getByTestId('quick-add-name').fill('detailed capture');
  await page.getByTestId('priority-high').click();
  await page.getByTestId('task-estimate-input').fill('2');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('quick-add')).toHaveCount(0);

  await page.getByTestId(/^list-row-/).first().click();
  await page.getByText('detailed capture', { exact: true }).click();
  await expect(page.getByTestId('task-estimate-input')).toHaveValue('2');
});

test('remembers the last list used and targets it next time', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Alpha');
  await makeList(page, 'Beta');

  await page.getByTestId('quick-add-open').click();
  await page.getByTestId('quick-add-list').selectOption({ label: 'Beta' });
  await page.getByTestId('quick-add-name').fill('goes to beta');
  await page.getByTestId('quick-add-done').click();

  // reopening defaults to Beta, not the first list
  await page.getByTestId('quick-add-open').click();
  await expect(page.getByTestId('quick-add-list')).toHaveValue(
    await page.getByTestId('quick-add-list').evaluate((el: HTMLSelectElement) => el.value),
  );
  const selectedLabel = await page.getByTestId('quick-add-list')
    .evaluate((el: HTMLSelectElement) => el.selectedOptions[0]?.textContent);
  expect(selectedLabel).toBe('Beta');
  await page.getByTestId('quick-add-done').click();

  // and the task really landed in Beta
  await page.getByTestId(/^list-row-/).filter({ hasText: 'Beta' }).click();
  await expect(page.getByText('goes to beta', { exact: true })).toBeVisible();
});
