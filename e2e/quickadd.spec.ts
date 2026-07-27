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

test('the name field is focused the moment quick add opens, and stays focused', async ({ page }) => {
  // Reported 2026-07-28: tapping "+ todo" left the keyboard down on iOS. Focus
  // was being applied only AFTER the draft task had been written to IndexedDB,
  // which is a macrotask later — outside the user gesture, and iOS only raises
  // the keyboard for a focus() that happens inside one.
  await reset(page);
  await makeList(page, 'Inbox');

  // Type immediately, with no focus assertion first — an assertion would wait
  // for focus to arrive and hide the very lateness being tested. If the cursor
  // is not already there, these keystrokes go to the document and vanish.
  await page.getByTestId('quick-add-open').click();
  await page.keyboard.type('typed without tapping');
  await expect(page.getByTestId('quick-add-name')).toHaveValue('typed without tapping');
  await expect(page.getByTestId('quick-add-name')).toBeFocused();

  // And the cursor comes back for the next one rather than being dropped.
  await page.getByTestId('quick-add-another').click();
  await expect(page.getByTestId('quick-add')).toContainText('1 added');
  await expect(page.getByTestId('quick-add-name')).toBeFocused();
});

test('start now captures the task and puts it straight into progress', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Inbox');

  await page.getByTestId('quick-add-open').click();
  await page.getByTestId('quick-add-name').fill('do this right now');
  await page.getByTestId('quick-add-start').click();

  // Sheet closes, and it becomes the current task — not just flagged, but the
  // thing the app now says you are doing.
  await expect(page.getByTestId('quick-add')).toHaveCount(0);
  await expect(page.getByTestId('current-task-card')).toContainText('do this right now');

  // …and it is genuinely in progress, with the clock running.
  await page.getByTestId('inprogress-link').click();
  await expect(page.getByText('do this right now', { exact: true })).toBeVisible();
});

test('start now displaces whatever was current, because that is the point', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Inbox');

  await page.getByTestId('quick-add-open').click();
  await page.getByTestId('quick-add-name').fill('the old current');
  await page.getByTestId('quick-add-start').click();
  await expect(page.getByTestId('current-task-card')).toContainText('the old current');

  await page.getByTestId('quick-add-open').click();
  await page.getByTestId('quick-add-name').fill('the new current');
  await page.getByTestId('quick-add-start').click();
  await expect(page.getByTestId('current-task-card')).toContainText('the new current');
});

test('start now on an empty field keeps the sheet open rather than making a blank', async ({
  page,
}) => {
  await reset(page);
  await makeList(page, 'Inbox');

  await page.getByTestId('quick-add-open').click();
  await page.getByTestId('quick-add-start').click();
  await expect(page.getByTestId('quick-add')).toBeVisible();
  await expect(page.getByTestId('quick-add-name')).toBeFocused();
});
