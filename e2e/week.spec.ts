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

test('the week screen counts this week and lists the wins', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Weekly');
  await page.getByTestId('new-list-input').press('Enter');
  for (const name of ['ship the thing', 'water the ficus']) {
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

  // In via the stats screen's link — the path a person would actually take.
  await page.getByTestId('stats-strip').click();
  await page.getByTestId('stats-week-link').click();

  await expect(page.getByTestId('week-hero')).toContainText('2');
  await expect(page.getByTestId('week-hero')).toContainText('done since Monday');
  const wins = page.getByTestId('week-wins');
  await expect(wins).toContainText('ship the thing');
  await expect(wins).toContainText('water the ficus');

  // Day strip: today's column carries the 2.
  await expect(page.getByTestId('week-days')).toContainText('2');

  // Back lands on stats, not home.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('stats-estimate')).toBeVisible();
});

test('an empty week says the week is young', async ({ page }) => {
  await page.goto('./#/week');
  await expect(page.getByTestId('week-hero')).toContainText('0');
  await expect(page.locator('.empty')).toContainText('the week is young');
  await expect(page.getByTestId('week-wins')).toHaveCount(0);
});
