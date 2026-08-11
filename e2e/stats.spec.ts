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
  await expect(page.getByTestId('stats-open-count'), 'the open-todo count line')
    .toContainText('across 0 open todos');
  await expect(page.locator('svg[role="img"]')).toHaveCount(2); // bar + line charts
  await page.getByTestId('stats-gran-week').click(); // toggle doesn't explode
  await expect(page.locator('svg[role="img"]')).toHaveCount(2);
});

test('tapping the burden delta itemizes who moved the pile', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Lake');
  await page.getByTestId('new-list-input').press('Enter');

  // Two by hand (default 1h), one made recurring (rule-born pile weight),
  // and one older-looking finished task is impossible to seed by UI today —
  // added/finished sections carry the assertion load.
  for (const name of ['temp one', 'temp two']) {
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-name-input').fill(name);
    await page.getByTestId('task-collapse').click();
  }
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('daily stretch');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill('1');
  await page.getByTestId('recur-save').click();
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('stats-strip').click();
  await page.getByTestId('stats-burden-open').click();

  const shift = page.getByTestId('burden-shift');
  await expect(shift).toBeVisible();
  // Hand-added tasks itemize under "added"…
  await expect(shift).toContainText('temp one');
  await expect(shift).toContainText('temp two');
  // …and the task attached to a rule sits apart, answering "how much of
  // this is my repeating stuff" at a glance (the 2026-08-11 ask).
  await expect(shift).toContainText('from repeating rules');
  await expect(shift).toContainText('daily stretch');

  // Collapses again on tap.
  await page.getByTestId('stats-burden-open').click();
  await expect(shift).toHaveCount(0);
});

test('list health names the list most in need of the sweep', async ({ page }) => {
  // beforeEach already reset. Tidy list: one task, triaged by touching a field.
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Tidy');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('reviewed thing');
  await page.getByTestId('priority-high').click(); // touching a field = triaged
  await page.waitForTimeout(250);
  await page.getByTestId('task-collapse').last().click();
  await page.getByTestId('back').click();

  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Messy');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('never looked at');
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('stats-strip').click();
  const table = page.getByTestId('list-health');
  await expect(table).toBeVisible();
  const firstRow = table.locator('tbody tr').first();
  await expect(firstRow, 'the untriaged list leads').toContainText('Messy');
  await expect(firstRow).toContainText('1');
  await page.getByTestId('health-sweep').click();
  await expect(page.getByTestId('sweep-card')).toContainText('never looked at');
});
