import { expect, test } from '@playwright/test';

async function reset(page: import('@playwright/test').Page) {
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

async function seedOne(page: import('@playwright/test').Page, name: string) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Juice');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill(name);
  await page.getByTestId('task-collapse').click();
}

test('reduced motion: completion works immediately with no animation gate', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await reset(page);
  await seedOne(page, 'sober task');
  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
  await page.getByTestId('back').click();
  await page.getByTestId('completed-link').click();
  await expect(page.getByText('sober task')).toBeVisible();
});

test('full motion: the celebration delay never eats the completion', async ({ page }) => {
  await reset(page);
  await seedOne(page, 'party task');
  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0); // slide-out finished
  await page.getByTestId('back').click();
  await page.getByTestId('completed-link').click();
  await expect(page.getByText('party task')).toBeVisible(); // mutation landed
});
