import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
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

test('draw → accept → current task card survives reload → complete', async ({ page }) => {
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

test('not now cycles to a different task; exhausting pool offers skip reset', async ({ page }) => {
  await seed(page, ['one', 'two']);
  await page.getByTestId('big-button').click();
  const first = await page.getByTestId('draw-card').textContent();
  await page.getByTestId('draw-not-now').click();
  const second = await page.getByTestId('draw-card').textContent();
  expect(second).not.toBe(first); // guaranteed different task
  await page.getByTestId('draw-not-now').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible();
  await page.getByTestId('draw-reset-skips').click();
  await expect(page.getByTestId('draw-card')).toBeVisible();
});

test('not today truly snoozes: pool empties with no reset offer, task stays in list', async ({ page }) => {
  await seed(page, ['snoozeme']);
  await page.getByTestId('big-button').click();
  await page.getByTestId('draw-not-today').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible();
  await expect(page.getByTestId('draw-reset-skips')).toHaveCount(0); // real snooze, not a skip
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByText('snoozeme')).toBeVisible(); // unaffected outside the randomizer
});

test('in-progress task is preferred by the draw', async ({ page }) => {
  await seed(page, ['started', 'fresh']);
  await page.getByTestId(/^list-row-/).first().click();
  await page.getByText('started', { exact: true }).click();
  await page.getByTestId('task-make-current').click(); // lands on home with card
  await expect(page.getByTestId('current-task-card')).toContainText('started');
  await page.getByTestId('current-clear').click(); // no longer current, still inProgress
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('started'); // deterministic preference
});

test('list-scoped randomizer only draws from that list', async ({ page }) => {
  await seed(page, ['inpool']);
  // second list with a task that must never be drawn
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Other');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('outsider');
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId(/^list-row-/).first().click(); // "Pool"
  await page.getByTestId('list-randomize').click();
  await expect(page.getByTestId('draw-card')).toContainText('inpool');
  await page.getByTestId('draw-not-now').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible(); // outsider never appears
});
