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

test('completions feed the strip and the stats screen renders both charts', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Statsy');
  await page.getByTestId('new-list-input').press('Enter');
  for (const name of ['one', 'two']) {
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-name-input').fill(name);
    await page.getByTestId('task-collapse').click();
  }
  const rows = page.getByTestId(/^task-row-/);
  for (let i = 0; i < 2; i++) {
    const id = (await rows.first().getAttribute('data-testid'))!.replace('task-row-', '');
    await page.getByTestId(`task-check-${id}`).click();
    await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
  }
  await page.getByTestId('back').click();

  await expect(page.getByTestId('stats-strip')).toContainText('2');
  await page.getByTestId('stats-strip').click();

  await expect(page.getByTestId('stats-estimate')).toContainText('0h'); // nothing open
  await expect(page.locator('svg[role="img"]')).toHaveCount(2); // bar + line charts
  await page.getByTestId('stats-gran-week').click(); // toggle doesn't explode
  await expect(page.locator('svg[role="img"]')).toHaveCount(2);
});
