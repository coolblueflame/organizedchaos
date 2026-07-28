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
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().waitFor();

  // Typing "Work" when "work" exists now reuses it rather than making a second
  // tag, so a case-variant duplicate can only arrive the way Ben's did — from an
  // import. Write that state directly, which is also fewer moving parts than
  // driving two editors.
  await page.evaluate(async () => {
    const listId = (document.querySelector('[data-testid^="list-row-"]') as HTMLElement).dataset.testid!
      .replace('list-row-', '');
    const stamp = { createdAt: 0, updatedAt: 1, deleted: false };
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('organizedchaos');
      open.onsuccess = () => {
        const tx = open.result.transaction(['tags', 'tasks'], 'readwrite');
        tx.objectStore('tags').put({ id: 'lower', name: 'work', colorIndex: 1, ...stamp });
        tx.objectStore('tags').put({ id: 'upper', name: 'Work', colorIndex: 2, ...stamp });
        const task = (id: string, name: string, tagIds: string[]) => ({
          id, listId, name, notes: '', tagIds, priority: 'medium',
          inProgress: false, ...stamp,
        });
        tx.objectStore('tasks').put(task('t-lower', 'send invoices', ['lower']));
        tx.objectStore('tasks').put(task('t-upper', 'book travel', ['upper']));
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.goto('./#/tags');
  await page.reload();

  // Both spellings are flagged as one tag typed twice.
  const group = page.getByTestId(/^dupe-group-/).first();
  await expect(group).toContainText('work');
  await expect(group).toContainText('Work');

  await page.getByTestId(/^merge-group-/).first().click();

  // One tag left, wearing both tasks.
  await expect(page.getByTestId(/^tag-row-/)).toHaveCount(1);
  await expect(page.getByTestId(/^dupe-group-/)).toHaveCount(0);
  await expect(page.getByTestId(/^tag-row-/).first()).toContainText('2 open');

  // And the tasks kept their tag rather than losing it with the merge.
  await page.goto('./#/sort/tag');
  await page.reload();
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
    // Adding a tag rewrites the task, which can re-sort and remount the row —
    // so re-open the box rather than assuming it survived.
    if (await page.getByTestId('new-tag').isVisible()) await page.getByTestId('new-tag').click();
    await page.getByTestId('new-tag-input').fill(name);
    await page.getByTestId('new-tag-input').press('Enter');
  }
  if (await page.getByTestId('new-tag-done').isVisible()) await page.getByTestId('new-tag-done').click();
  // Take all three back off so every one of them reads as unused.
  for (const name of ['alpha', 'beta', 'gamma']) {
    await page.getByRole('button', { name, exact: true }).click();
  }
  await page.getByTestId('task-collapse').click();

  await page.goto('./#/tags');
  await expect(page.getByTestId(/^tag-row-/)).toHaveCount(3);
  await page.getByTestId('delete-unused').click();
  await expect(page.getByTestId(/^tag-row-/)).toHaveCount(0);

  await page.getByTestId('undo-toast').getByRole('button', { name: /undo/i }).click();
  await expect(page.getByTestId(/^tag-row-/), 'one undo puts all three back').toHaveCount(3);
});
