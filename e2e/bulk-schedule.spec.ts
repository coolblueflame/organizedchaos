import { expect, test, type Page } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'bulk flows on chromium');

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

/** Adds a task and returns its id; `setup` runs inside its open editor. */
async function addTask(page: Page, name: string, setup?: () => Promise<void>): Promise<string> {
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill(name);
  if (setup) await setup();
  await page.waitForTimeout(250); // let any re-sort settle before collapsing
  await page.getByTestId('task-collapse').last().click();
  const row = page.getByTestId(/^task-row-/).filter({ hasText: name }).first();
  return (await row.getAttribute('data-testid'))!.replace('task-row-', '');
}

async function ritualFrom(page: Page, from: string, to: string) {
  await page.getByTestId('task-ritual-row').click();
  await page.getByTestId('ritual-from').fill(from);
  await page.getByTestId('ritual-to').fill(to);
  await page.getByTestId('ritual-save').click();
}

async function repeatEvery(page: Page, days: string) {
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill(days);
  await page.getByTestId('recur-save').click();
}

async function openRituals(page: Page) {
  await page.evaluate(() => { location.hash = '#/rituals'; });
  await page.getByRole('heading', { name: 'Daily Rituals' }).waitFor();
}

test('the list bulk bar sets one ritual schedule on every pick, converting plain tasks, undoable', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Day');
  const stretch = await addTask(page, 'stretch', () => ritualFrom(page, '09:00', '09:30'));
  const water = await addTask(page, 'water');

  await page.getByTestId(`select-${stretch}`).click();
  await page.getByTestId(`select-${water}`).click();
  await page.getByTestId('bulk-ritual').click();
  const panel = page.getByTestId('bulk-ritual-panel');
  // Seeded from the selection's existing ritual.
  await expect(panel.getByTestId('ritual-from')).toHaveValue('09:00');
  await panel.getByTestId('ritual-from').fill('07:00');
  await panel.getByTestId('ritual-to').fill('08:00');
  await panel.getByTestId('ritual-save').click();
  await expect(page.getByText('Set ritual times on 2 tasks', { exact: true })).toBeVisible();
  await expect(panel).toHaveCount(0);

  await openRituals(page);
  await expect(page.getByTestId(`ritual-row-${stretch}`)).toContainText('07:00–08:00');
  await expect(page.getByTestId(`ritual-row-${water}`), 'the plain task became a ritual')
    .toContainText('07:00–08:00');

  // One undo puts each back as it was: the old time, and no ritual at all.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId(`ritual-row-${stretch}`)).toContainText('09:00–09:30');
  await expect(page.getByTestId(`ritual-row-${water}`)).toHaveCount(0);
});

test('the list bulk bar sets one repeat rule on every pick, starting rules for plain tasks, undoable', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Chores');
  const plants = await addTask(page, 'plants', () => repeatEvery(page, '3'));
  const towels = await addTask(page, 'towels');

  await page.getByTestId(`select-${plants}`).click();
  await page.getByTestId(`select-${towels}`).click();
  await page.getByTestId('bulk-repeat').click();
  const panel = page.getByTestId('bulk-repeat-panel');
  await expect(panel.getByTestId('recur-interval'), 'seeded from the existing rule').toHaveValue('3');
  await panel.getByTestId('recur-interval').fill('5');
  await panel.getByTestId('recur-save').click();
  await expect(page.getByText('Set repeat on 2 tasks', { exact: true })).toBeVisible();
  await page.getByTestId('bulk-done').click();

  const ruleOf = async (name: string) => {
    await page.getByText(name, { exact: true }).click();
    const text = await page.getByTestId('task-recur-row').innerText();
    await page.getByTestId('task-collapse').last().click();
    return text;
  };
  expect(await ruleOf('plants')).toContain('5 days after completion');
  expect(await ruleOf('towels'), 'the plain task started repeating').toContain('5 days after completion');

  await page.keyboard.press('Control+z');
  await expect.poll(() => ruleOf('plants')).toContain('3 days after completion');
  expect(await ruleOf('towels')).toContain('make recurring');
});

test('the Rituals screen selects rituals across lists and re-times them together', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Morning');
  const a = await addTask(page, 'meds', () => ritualFrom(page, '08:00', '08:30'));
  await page.getByTestId('back').click();
  await makeList(page, 'Evening');
  const b = await addTask(page, 'wind down', () => ritualFrom(page, '21:00', '22:00'));

  await openRituals(page);
  await page.getByTestId('rituals-select').click();
  // While selecting, a row tap picks it rather than opening the editor or
  // ticking it off.
  await expect(page.getByTestId(`ritual-complete-${a}`)).toHaveCount(0);
  await page.getByTestId(`ritual-edit-${a}`).click();
  await page.getByTestId(`ritual-pick-${b}`).click();
  await expect(page.getByTestId('ritual-editor-sheet')).toHaveCount(0);
  await expect(page.getByTestId('rituals-bulk-bar')).toContainText('2 selected');
  await expect(page.getByTestId('bulk-repeat'), 'rituals only re-time here').toHaveCount(0);

  await page.getByTestId('bulk-ritual').click();
  const panel = page.getByTestId('bulk-ritual-panel');
  await panel.getByTestId('ritual-from').fill('06:00');
  await panel.getByTestId('ritual-to').fill('06:30');
  await panel.getByTestId('ritual-save').click();
  await expect(page.getByTestId(`ritual-row-${a}`)).toContainText('06:00–06:30');
  await expect(page.getByTestId(`ritual-row-${b}`)).toContainText('06:00–06:30');

  await page.getByTestId('rituals-select').click(); // done
  await expect(page.getByTestId('rituals-bulk-bar')).toHaveCount(0);
  await expect(page.getByTestId(`ritual-complete-${a}`)).toBeVisible();
});
