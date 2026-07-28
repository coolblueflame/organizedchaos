import { expect, test, type Page } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'tag housekeeping on chromium');

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

/** A task in the open list, wearing a freshly-created tag of the given name. */
async function taskWithTag(page: Page, taskName: string, tagName: string) {
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill(taskName);
  await page.getByTestId('new-tag').click();
  await page.getByTestId('new-tag-input').fill(tagName);
  await page.getByTestId('new-tag-input').press('Enter');
  await page.getByTestId('task-collapse').click();
}

async function setUpList(page: Page) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Errands');
  await page.getByTestId('new-list-input').press('Enter');
}

test('rename, delete and undo a tag', async ({ page }) => {
  await reset(page);
  await setUpList(page);
  await taskWithTag(page, 'post office', 'erands');
  await page.goto('./#/tags');

  const row = page.getByTestId(/^tag-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('tag-row-', '');
  await expect(page.getByTestId(`tag-name-${id}`)).toHaveText('erands');
  await expect(row).toContainText('1 open');

  await page.getByTestId(`tag-name-${id}`).click();
  await page.getByTestId(`tag-rename-${id}`).fill('errands');
  await page.getByTestId(`tag-rename-${id}`).press('Enter');
  await expect(page.getByTestId(`tag-name-${id}`)).toHaveText('errands');

  await page.getByTestId(`tag-delete-${id}`).click();
  await expect(page.getByTestId(`tag-row-${id}`)).toHaveCount(0);

  await page.getByTestId('undo-toast').getByRole('button', { name: /undo/i }).click();
  await expect(page.getByTestId(`tag-name-${id}`)).toHaveText('errands');
});

test('merges two spellings of the same tag, keeping both tasks', async ({ page }) => {
  await reset(page);
  await setUpList(page);
  await taskWithTag(page, 'send invoices', 'work');
  await taskWithTag(page, 'book travel', 'Work');
  await page.goto('./#/tags');

  // Both spellings are flagged as one tag typed twice.
  const group = page.getByTestId(/^dupe-group-/).first();
  await expect(group).toContainText('work');
  await expect(group).toContainText('Work');

  const mergeButton = page.getByTestId(/^merge-group-/).first();
  await mergeButton.click();

  // One tag left, wearing both tasks.
  await expect(page.getByTestId(/^tag-row-/)).toHaveCount(1);
  await expect(page.getByTestId(/^dupe-group-/)).toHaveCount(0);
  await expect(page.getByTestId(/^tag-row-/).first()).toContainText('2 open');

  // And the tasks kept their tag rather than losing it with the merge.
  await page.goto('./#/sort/tag');
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(2);
});

test('clears out tags nothing is using, in one go', async ({ page }) => {
  await reset(page);
  await setUpList(page);
  // Three tags made on one task, then all three toggled back off, so every one
  // of them exists while nothing wears it.
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('a task');
  for (const name of ['alpha', 'beta', 'gamma']) {
    await page.getByTestId('new-tag').click();
    await page.getByTestId('new-tag-input').fill(name);
    await page.getByTestId('new-tag-input').press('Enter');
    await page.getByRole('button', { name, exact: true }).click(); // toggle straight back off
  }
  await page.getByTestId('task-collapse').click();

  await page.goto('./#/tags');
  await expect(page.getByTestId(/^tag-row-/)).toHaveCount(3);
  await page.getByTestId('delete-unused').click();
  await expect(page.getByTestId(/^tag-row-/)).toHaveCount(0);

  await page.getByTestId('undo-toast').getByRole('button', { name: /undo/i }).click();
  await expect(page.getByTestId(/^tag-row-/), 'one undo puts all three back').toHaveCount(3);
});
