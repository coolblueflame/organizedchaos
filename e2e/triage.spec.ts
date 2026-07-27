import { expect, test, type Page } from '@playwright/test';

/** The untriaged dot and the randomizer's fill-in prompt. */
test.skip(({ browserName }) => browserName !== 'chromium', 'triage flows on chromium');

async function reset(page: Page, force?: string) {
  await page.goto('./');
  await page.evaluate(
    ([f]) =>
      new Promise<void>((resolve) => {
        if (f) localStorage.setItem('OC_EGG_FORCE', f);
        else localStorage.removeItem('OC_EGG_FORCE');
        const req = indexedDB.deleteDatabase('organizedchaos');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
    [force],
  );
  await page.reload();
  await page.getByTestId('new-list').waitFor();
}

async function addTask(page: Page, name: string) {
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill(name);
  await page.getByTestId('task-collapse').click();
  const row = page.getByTestId(/^task-row-/).first();
  return (await row.getAttribute('data-testid'))!.replace('task-row-', '');
}

test('naming a task leaves the dot; touching a field clears it', async ({ page }) => {
  await reset(page);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Triage');
  await page.getByTestId('new-list-input').press('Enter');

  const id = await addTask(page, 'only named');
  await expect(page.getByTestId(`needs-review-${id}`)).toBeVisible();

  // Re-picking the priority it already had still counts as a decision.
  await page.getByText('only named').click();
  await page.getByTestId('priority-medium').click();
  await page.getByTestId('task-collapse').click();
  await expect(page.getByTestId(`needs-review-${id}`)).toHaveCount(0);
});

test('deliberately opening a task counts as the once-over', async ({ page }) => {
  await reset(page);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Triage');
  await page.getByTestId('new-list-input').press('Enter');
  const id = await addTask(page, 'just look at me');
  await expect(page.getByTestId(`needs-review-${id}`)).toBeVisible();

  await page.getByText('just look at me').click(); // open…
  await page.getByTestId('task-collapse').click(); // …and close
  await expect(page.getByTestId(`needs-review-${id}`)).toHaveCount(0);
});

test('the randomizer offers a fill-in prompt that clears the dot when done', async ({ page }) => {
  await reset(page, 'triage');
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Triage');
  await page.getByTestId('new-list-input').press('Enter');
  const id = await addTask(page, 'needs details');
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-triage')).toContainText('needs details');

  await page.getByTestId('triage-estimate').fill('3');
  await page.getByTestId('priority-high').click();
  await page.getByTestId('triage-done').click();

  // Falls through to a normal roll, and the task is triaged with its new values
  await expect(page.getByTestId('draw-card')).toBeVisible();
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(`needs-review-${id}`)).toHaveCount(0);
  await page.getByText('needs details').click();
  await expect(page.getByTestId('task-estimate-input')).toHaveValue('3');
});

test('skipping the fill-in prompt keeps the task untriaged', async ({ page }) => {
  await reset(page, 'triage');
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Triage');
  await page.getByTestId('new-list-input').press('Enter');
  const id = await addTask(page, 'not yet');
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-triage')).toBeVisible();
  await page.getByTestId('triage-skip').click();
  await expect(page.getByTestId('draw-card')).toBeVisible();

  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(`needs-review-${id}`)).toBeVisible();
});
