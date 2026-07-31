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

/** Pin the page clock (no reload afterwards — webkit loses mocks) and poke
    the app's shared clock to re-read the mocked date. */
async function pinClock(page: import('@playwright/test').Page, date: Date) {
  await page.clock.setFixedTime(date);
  await page.evaluate(() => (window as unknown as { __ocTickClock?: () => void }).__ocTickClock?.());
}

test('before December, Wrapped is a sealed teaser with a countdown', async ({ page }) => {
  // Pin to a mid-July noon so the test says the same thing in any real month.
  await pinClock(page, new Date(new Date().getFullYear(), 6, 15, 12, 0));

  await page.getByTestId('stats-strip').click();
  await page.getByTestId('stats-wrapped-link').click();

  const teaser = page.getByTestId('wrapped-teaser');
  await expect(teaser).toContainText('so far');
  await expect(teaser).toContainText('December 1st');
  await expect(page.getByTestId('wrapped-hero')).toHaveCount(0); // sealed
});

test('in December, Wrapped opens with the year in superlatives', async ({ page }) => {
  await pinClock(page, new Date(new Date().getFullYear(), 11, 15, 12, 0));

  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Year of Doing');
  await page.getByTestId('new-list-input').press('Enter');
  for (const name of ['shipped the app', 'learned the banjo']) {
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

  await page.getByTestId('stats-strip').click();
  await page.getByTestId('stats-wrapped-link').click();

  await expect(page.getByTestId('wrapped-hero')).toContainText('2');
  await expect(page.getByTestId('wrapped-hero')).toContainText('things finished');
  await expect(page.getByTestId('wrapped-months')).toBeVisible();
  await expect(page.getByTestId('wrapped-lists')).toContainText('Year of Doing');
  const wins = page.getByTestId('wrapped-wins');
  await expect(wins).toContainText('shipped the app');
  await expect(wins).toContainText('learned the banjo');
  await expect(page.getByTestId('wrapped-teaser')).toHaveCount(0); // unsealed

  // Back lands on stats.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('stats-estimate')).toBeVisible();
});
