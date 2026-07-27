import { expect, test, type Page } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'feature flows on chromium');

async function reset(page: Page) {
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

async function makeList(page: Page, title: string) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill(title);
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').waitFor();
}

async function addTask(page: Page, name: string) {
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill(name);
  await page.waitForTimeout(250); // let any re-sort settle before collapsing
  await page.getByTestId('task-collapse').last().click();
}

test('list settings: shows the name, cancels cleanly, saves weekday hours', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Office');
  await page.getByTestId('back').click();
  const listId = (await page.getByTestId(/^list-row-/).first().getAttribute('data-testid'))!
    .replace('list-row-', '');

  // opens with the list's name visible, and Escape leaves no changes
  await page.getByTestId(`list-menu-${listId}`).click();
  await expect(page.getByTestId('list-settings-title')).toHaveValue('Office');
  await page.getByTestId('list-settings-title').fill('Renamed but cancelled');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('list-settings')).toHaveCount(0);
  await expect(page.getByTestId(`list-row-${listId}`)).toContainText('Office');

  // weekday-only hours save and show on the row
  await page.getByTestId(`list-menu-${listId}`).click();
  await page.getByTestId('hours-add-weekdays').click();
  await page.getByTestId('hours-rule-0-from').fill('09:00');
  await page.getByTestId('hours-rule-0-to').fill('17:00');
  await page.getByTestId('list-settings-save').click();
  await expect(page.getByTestId(`list-row-${listId}`)).toContainText('weekdays 9:00–17:00');
});

test('project deadline shows the remaining workload and marks the list', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Big Project');
  await addTask(page, 'part one');
  await addTask(page, 'part two');
  await page.getByTestId('back').click();
  const listId = (await page.getByTestId(/^list-row-/).first().getAttribute('data-testid'))!
    .replace('list-row-', '');

  await page.getByTestId(`list-menu-${listId}`).click();
  await page.getByTestId('list-settings-deadline').fill('2026-08-30');
  await expect(page.getByTestId('list-settings-readout')).toContainText('2h of work left');
  await page.getByTestId('list-settings-save').click();
  await expect(page.getByTestId(`list-row-${listId}`)).toContainText('08-30');
  // Setting a deadline earns a discovery, but celebrations stay suppressed
  // under automation — an overlay here would sit on top of the next click.
  await expect(page.getByTestId('delight-unlock')).toHaveCount(0);
});

test('sub-sort reorders within a group', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Ordering');
  await addTask(page, 'zebra');
  await addTask(page, 'apple');

  // default 'smart' keeps insertion order for equal priorities
  await expect(page.getByTestId('list-subsort')).toContainText('smart');
  await page.getByTestId('list-subsort').click();
  await expect(page.getByTestId('list-subsort')).toContainText('a–z');

  const names = await page.getByTestId(/^task-row-/).allTextContents();
  expect(names[0]).toContain('apple');
  expect(names[1]).toContain('zebra');
});

test('dragging a task onto another priority group adopts it', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Dragging');
  await addTask(page, 'promote me');

  // it starts in Medium; drag it to the Max header
  await expect(page.getByTestId('group-medium')).toBeVisible();
  const row = page.getByTestId(/^task-row-/).first();
  await page.getByText('promote me', { exact: true }).click(); // open
  await page.getByTestId('priority-max').click();              // seed a Max group to aim at
  await page.getByTestId('task-collapse').last().click();
  await addTask(page, 'drag target');

  const source = page.getByTestId(/^task-row-/).filter({ hasText: 'drag target' }).first();
  const box = (await source.boundingBox())!;
  const header = (await page.getByTestId('group-max').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2, { steps: 12 });
  await page.mouse.up();

  // now both live under Max
  await page.getByText('drag target', { exact: true }).click();
  await expect(page.getByTestId('priority-max')).toHaveAttribute('aria-checked', 'true');
  await expect(row).toBeVisible();
});

test('multi-select bulk-completes several tasks, undoable as one', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Bulk');
  await addTask(page, 'one');
  await addTask(page, 'two');
  await addTask(page, 'three');

  const ids = await Promise.all(
    (await page.getByTestId(/^task-row-/).all()).map(async (row) =>
      (await row.getAttribute('data-testid'))!.replace('task-row-', '')),
  );
  await page.getByTestId(`select-${ids[0]}`).click();
  await page.getByTestId(`select-${ids[1]}`).click();
  await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');

  await page.getByTestId('bulk-complete').click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(1);

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(3);
});

test('selecting a whole group and moving it to another list', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Source');
  await addTask(page, 'movable');
  await page.getByTestId('back').click();
  await makeList(page, 'Destination');
  await page.getByTestId('back').click();

  await page.getByTestId(/^list-row-/).filter({ hasText: 'Source' }).click();
  await page.getByTestId('select-group-medium').click();
  await expect(page.getByTestId('bulk-bar')).toContainText('1 selected');
  await page.getByTestId('bulk-move').selectOption({ label: 'Destination' });

  await expect(page.getByTestId(/^task-row-/)).toHaveCount(0);
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).filter({ hasText: 'Destination' }).click();
  await expect(page.getByText('movable', { exact: true })).toBeVisible();
});

test('timebox counts down on the current task and can be cleared', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Boxed');
  await addTask(page, 'focus work');
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await page.getByTestId('draw-accept').click();
  await expect(page.getByTestId('current-task-card')).toContainText('focus work');

  await page.getByTestId('timebox-open').click();
  await page.getByTestId('timebox-15').click();
  await expect(page.getByTestId('timebox-running')).toContainText('14:5'); // ticking down from 15:00

  await page.getByTestId('timebox-running').click(); // tap clears it
  await expect(page.getByTestId('timebox-open')).toBeVisible();
});

test('a completed task records how long it took', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Timed');
  await addTask(page, 'quick one');
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await page.getByTestId('draw-accept').click();
  await page.getByTestId('current-complete').click();
  await expect(page.getByTestId('current-task-card')).toHaveCount(0);

  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('quick one');
  await expect(page.getByTestId('search-completed')).toContainText('⧗');
});
