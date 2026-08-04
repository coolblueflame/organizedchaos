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

test('after-completion task respawns after the interval (clock time-travel)', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Rec');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('water plants');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill('3');
  await page.getByTestId('recur-save').click();
  await page.getByTestId('task-collapse').click();

  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(0);

  // Four days later, reopening the app resurrects it via the init sweep.
  await page.clock.install({ time: Date.now() + 4 * 86_400_000 });
  await page.reload();
  await page.getByTestId('new-task').waitFor();
  await expect(page.getByTestId(/^task-row-/).first()).toContainText('water plants');
});

test('recurring screen lists, pauses, and deletes templates', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Rec');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('weekly thing');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-weekly').click();
  await page.getByTestId('recur-weekday-1').click();
  await page.getByTestId('recur-save').click();
  await page.getByTestId('back').click();

  await page.getByTestId('recurring-link').click();
  const row = page.getByTestId(/^recurring-row-/).first();
  await expect(row).toContainText('weekly thing');
  await expect(row).toContainText('every Mon');
  const id = (await row.getAttribute('data-testid'))!.replace('recurring-row-', '');

  // Tapping the row opens the cadence editor, same as the pencil does.
  await page.getByTestId(`recurring-open-${id}`).click();
  await expect(page.getByTestId('recur-save')).toBeVisible();
  await page.getByTestId(`recurring-open-${id}`).click(); // and closes it again
  await expect(page.getByTestId('recur-save')).toHaveCount(0);
  await page.getByTestId(`recurring-edit-${id}`).click();
  await expect(page.getByTestId('recur-save'), 'the pencil still works too').toBeVisible();
  await page.getByTestId(`recurring-edit-${id}`).click();

  await page.getByTestId(`recurring-pause-${id}`).click();
  await expect(row).toContainText('paused');
  page.on('dialog', (d) => void d.accept());
  await page.getByTestId(`recurring-delete-${id}`).click();
  await expect(page.getByTestId(`recurring-row-${id}`)).toHaveCount(0);
});

test('recurring rows surface the live copy, re-home it, and turn up in search', async ({ page }) => {
  // Two lists; the recurring task starts in Rec.
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Garden');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('back').click();
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Rec');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('water the ferns');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill('3');
  await page.getByTestId('recur-save').click();
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('recurring-link').click();
  const row = page.getByTestId(/^recurring-row-/).first();
  const tplId = (await row.getAttribute('data-testid'))!.replace('recurring-row-', '');

  // The live copy is named, and the jump lands in its list.
  await expect(page.getByTestId(`recurring-jump-${tplId}`)).toContainText('open copy in Rec');
  await page.getByTestId(`recurring-jump-${tplId}`).click();
  await expect(page.getByTestId(/^task-row-/).filter({ hasText: 'water the ferns' })).toHaveCount(1);
  await page.getByTestId('back').click();

  // Re-homing the rule moves the open copy with it.
  await page.getByTestId('recurring-link').click();
  const garden = await page.getByTestId(`recurring-move-${tplId}`)
    .locator('option', { hasText: 'Garden' }).getAttribute('value');
  await page.getByTestId(`recurring-move-${tplId}`).selectOption(garden!);
  await expect(page.getByTestId(`recurring-jump-${tplId}`)).toContainText('open copy in Garden');
  await page.getByTestId(`recurring-jump-${tplId}`).click();
  await expect(page.getByTestId(/^task-row-/).filter({ hasText: 'water the ferns' })).toHaveCount(1);
  await page.getByTestId('back').click();

  // The RULE is findable by search, between live and done.
  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('ferns');
  await expect(page.getByTestId('search-recurring')).toContainText('water the ferns');
  await page.getByTestId(`search-tpl-${tplId}`).click();
  await expect(page.getByTestId(`recurring-row-${tplId}`)).toBeVisible();
  // …and it lands ON that rule with its editor already open, rather than
  // dumping you at the top of the screen to find it again (2026-08-05 ask).
  await expect(page.getByTestId(`recurring-open-${tplId}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(new RegExp(`#/recurring/${tplId}$`));
});

test('editor shows the cadence summary on a recurring task', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Rec');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('rent');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-monthly').click();
  await page.getByTestId('recur-monthday').fill('1');
  await page.getByTestId('recur-deadline-offset').fill('5');
  await page.getByTestId('recur-save').click();
  await expect(page.getByTestId('task-recur-row')).toContainText('monthly on the 1st · deadline +5d');

  // 0 is not "unset": it means due the day the task appears, and must survive save.
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-deadline-offset').fill('0');
  await page.getByTestId('recur-save').click();
  await expect(page.getByTestId('task-recur-row')).toContainText('monthly on the 1st · due same day');
});
