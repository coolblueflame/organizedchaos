import { expect, test, type Page } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'skip flows on chromium');

/** Fresh app on Wednesday 2026-11-18, 10:00, with one list open. */
async function start(page: Page, list: string) {
  await page.clock.install({ time: new Date('2026-11-18T10:00:00') });
  await page.goto('./');
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        const req = indexedDB.deleteDatabase('organizedchaos');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
  );
  await page.reload();
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill(list);
  await page.getByTestId('new-list-input').press('Enter');
}

async function openRecurring(page: Page) {
  await page.evaluate(() => { location.hash = '#/recurring'; });
  return page.getByTestId(/^recurring-row-/).first();
}

test('skipping a weekly copy removes it until its next date, without completing it; undo brings it back', async ({ page }) => {
  await start(page, 'Home');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('bins');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-weekly').click();
  await page.getByTestId('recur-weekday-2').click();
  await page.getByTestId('recur-save').click();

  await page.getByTestId('task-skip-round').click();
  await expect(page.getByText('Skipped "bins" - next on Tue 11/24', { exact: true })).toBeVisible();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(0);
  await expect(page.getByTestId('list-completed'), 'skipped, not completed').toHaveCount(0);

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('task-name-input')).toHaveValue('bins');

  // On its next date a fresh copy arrives as normal.
  await page.getByTestId('task-skip-round').click();
  await page.clock.setSystemTime(new Date('2026-11-24T05:00:00'));
  await page.reload();
  await expect(page.getByTestId(/^task-row-/).filter({ hasText: 'bins' })).toHaveCount(1);
});

test('skipping an after-completion copy counts the interval from the skip', async ({ page }) => {
  await start(page, 'Plants');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('water ferns');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill('5');
  await page.getByTestId('recur-save').click();

  await page.getByTestId('task-skip-round').click();
  await expect(page.getByText('Skipped "water ferns" - next on Mon 11/23', { exact: true })).toBeVisible();
  // Not back tomorrow, the way a plain delete would bring it.
  await page.clock.setSystemTime(new Date('2026-11-19T05:00:00'));
  await page.reload();
  await expect(page.getByText('water ferns', { exact: true })).toHaveCount(0);
  await expect(await openRecurring(page)).toContainText('next: 11/23');
});

test('skipping a ritual quiets it for today without ticking it, and never offers on a plain task', async ({ page }) => {
  await start(page, 'Morning');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('plain one');
  await expect(page.getByTestId('task-skip-round'), 'plain tasks have nothing to skip to').toHaveCount(0);
  await page.getByTestId('task-collapse').click();

  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('stretch');
  await page.getByTestId('task-ritual-row').click();
  await page.getByTestId('ritual-from').fill('08:00');
  await page.getByTestId('ritual-to').fill('20:00');
  await page.getByTestId('ritual-save').click();
  await page.getByTestId('task-skip-round').click();
  await expect(page.getByText('Skipped "stretch" for today', { exact: true })).toBeVisible();
  await expect(page.getByTestId('task-skip-round'), 'nothing left to skip today').toHaveCount(0);
  await page.getByTestId('task-collapse').click();
  await expect(page.getByTestId('list-completed'), 'a skip writes no completed record').toHaveCount(0);

  await page.evaluate(() => { location.hash = '#/rituals'; });
  await page.getByRole('heading', { name: 'Daily Rituals' }).waitFor();
  await expect(page.getByText('done or skipped today')).toBeVisible();
  const id = (await page.getByTestId(/^ritual-row-/).first().getAttribute('data-testid'))!.replace('ritual-row-', '');
  await expect(page.getByTestId(`ritual-skipped-${id}`)).toBeVisible();
  await expect(page.getByTestId(`ritual-complete-${id}`)).toHaveAttribute('aria-label', 'skipped today');

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId(`ritual-complete-${id}`)).toHaveAttribute('aria-label', 'mark done for today');

  // Tomorrow it is owed again as usual.
  await page.keyboard.press('Control+Shift+z');
  await page.clock.setSystemTime(new Date('2026-11-19T10:00:00'));
  await page.reload();
  await expect(page.getByTestId(`ritual-complete-${id}`)).toHaveAttribute('aria-label', 'mark done for today');
});

test('the draw card offers skip round for a repeating copy and draws the next one', async ({ page }) => {
  await start(page, 'Chores');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('vacuum');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-weekly').click();
  await page.getByTestId('recur-weekday-3').click();
  await page.getByTestId('recur-save').click();
  await page.getByTestId('task-collapse').click();

  await page.evaluate(() => { location.hash = '#/randomizer'; });
  await expect(page.getByTestId('draw-skip-round')).toBeVisible();
  await page.getByTestId('draw-skip-round').click();
  await expect(page.getByText('Skipped "vacuum" - next on Wed 11/25', { exact: true })).toBeVisible();
  await expect(page.getByTestId('draw-empty')).toBeVisible();
});
