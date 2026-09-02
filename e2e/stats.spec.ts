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

test('once yesterday is measured, deletes and estimate fixes move the delta', async ({ page }) => {
  // The 2026-08-12 ask: "my todo time goes down if I delete a bunch of tasks
  // or properly estimate!" The reconstruction can't see either; the ledger
  // (a written-down reading per day) can.
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Ledger');
  await page.getByTestId('new-list-input').press('Enter');
  for (const [name, est] of [['heavy chore', '3h'], ['wild guess', '2h']] as const) {
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-name-input').fill(name);
    await page.getByTestId('task-estimate-input').fill(est);
    await page.getByTestId('task-collapse').click();
  }

  // Cross the rollover: tomorrow's first sweep writes the day's baseline
  // with both tasks standing (5h measured).
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  tomorrow.setHours(6, 0, 0, 0);
  await page.clock.setFixedTime(tomorrow);
  await page.evaluate(() => (window as unknown as { __ocTickClock?: () => void }).__ocTickClock?.());
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  // Delete one (3h) and shrink the other's estimate (2h → 30m).
  const heavyRow = page.getByTestId(/^task-row-/).filter({ hasText: 'heavy chore' }).first();
  const heavyId = (await heavyRow.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-delete-${heavyId}`).click(); // arms…
  await page.getByTestId(`task-delete-${heavyId}`).click(); // …means it
  await expect(page.getByTestId(`task-row-${heavyId}`)).toHaveCount(0);
  await page.getByText('wild guess', { exact: true }).click();
  await page.getByTestId('task-estimate-input').fill('30m');
  await page.getByTestId('task-collapse').click();

  // Reload before reading stats: a just-deleted row lives in the undo trash,
  // not the mirror, until state is re-read from disk — and checking stats
  // later is exactly the real usage. The mocked clock survives the reload,
  // and so does the route hash — step back to home where the strip lives.
  await page.reload();
  await page.getByTestId('back').click();
  await page.getByTestId('stats-strip').waitFor();

  // live 0.5h vs measured 5h = 4h 30m lighter — the number a human expects.
  await page.getByTestId('stats-strip').click();
  await expect(page.getByTestId('stats-burden-delta')).toContainText('4h 30m lighter');

  // The breakdown reconciles to the minute: the deletion is attributable to
  // its tombstone; the estimate edit is no row's to own, so it appears as
  // the adjustments line (3h removed + 1h 30m adjusted = 4h 30m).
  await page.getByTestId('stats-burden-open').click();
  const shift = page.getByTestId('burden-shift');
  await expect(shift).toContainText('heavy chore');
  await expect(page.getByTestId('shift-adjustments')).toContainText('1h 30m');
});

test('a half-hour win is a win, not "no change"', async ({ page }) => {
  // 2026-09-02: the headline rounded to the nearest hour while the breakdown
  // reported to the minute, so 6h30m added against 7h of edits — a real 30
  // minutes lighter — read as "no change".
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Fine');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('over-estimated thing');
  await page.getByTestId('task-estimate-input').fill('1h');
  await page.getByTestId('task-collapse').click();

  // Cross the rollover so the day's baseline is measured at 1h.
  const tomorrow = new Date(Date.now() + 24 * 3600_000);
  tomorrow.setHours(6, 0, 0, 0);
  await page.clock.setFixedTime(tomorrow);
  await page.evaluate(() => (window as unknown as { __ocTickClock?: () => void }).__ocTickClock?.());
  await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));

  // Correct it to 30m: exactly half an hour lighter than the measured day.
  await page.getByText('over-estimated thing', { exact: true }).click();
  await page.getByTestId('task-estimate-input').fill('30m');
  await page.getByTestId('task-collapse').click();
  await page.reload();
  await page.getByTestId('back').click();
  await page.getByTestId('stats-strip').waitFor();

  await page.getByTestId('stats-strip').click();
  await expect(page.getByTestId('stats-burden-delta')).toContainText('30m lighter');
  await expect(page.getByTestId('stats-burden-delta')).not.toContainText('no change');

  // And the breakdown accounts for it to the minute rather than staying quiet.
  await page.getByTestId('stats-burden-open').click();
  await expect(page.getByTestId('shift-adjustments')).toContainText('30m');
});

test('archiving a list takes its hours off the books', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Shelf');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('dusty project');
  await page.getByTestId('task-estimate-input').fill('4h');
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('stats-strip').click();
  await expect(page.getByTestId('stats-estimate')).toContainText('4h');
  await page.getByTestId('back').click();

  // Shelved means abandoned, and abandoned is not owed (2026-08-12 ask).
  const listId = (await page.getByTestId(/^list-row-/).first().getAttribute('data-testid'))!
    .replace('list-row-', '');
  await page.getByTestId(`list-menu-${listId}`).click();
  await page.getByTestId('list-settings-archive').click();

  await page.getByTestId('stats-strip').click();
  await expect(page.getByTestId('stats-open-count')).toContainText('across 0 open todos');
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
