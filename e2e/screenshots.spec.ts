/**
 * Not a test — a screenshot rig for visual review rounds with Ben.
 * Inert in CI; run locally with:  SCREENSHOTS=1 npx playwright test screenshots --project=webkit
 * Outputs iPhone-sized PNGs to ./screenshots/ (gitignored).
 */
import { test } from '@playwright/test';

test.skip(!process.env.SCREENSHOTS, 'screenshot rig — set SCREENSHOTS=1 to run');

test('capture app screens', async ({ page }) => {
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

  // Seed a believable world: two grouped lists, tags, deadlines, a current task.
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('House');
  await page.getByTestId('new-list-input').press('Enter');

  const addTask = async (name: string, extras?: () => Promise<void>) => {
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-name-input').fill(name);
    if (extras) await extras();
    // .last() + settle: editing can re-group a row, leaving a ~220ms outro ghost
    await page.waitForTimeout(300);
    await page.getByTestId('task-collapse').last().click();
  };

  await addTask('fix the leaky faucet', async () => {
    await page.getByTestId('priority-high').click();
    await page.getByTestId('new-tag').click();
    await page.getByTestId('new-tag-input').fill('diy');
    await page.getByTestId('new-tag-save').click();
    await page.getByTestId('task-estimate-input').fill('2');
  });
  await addTask('water the plants', async () => {
    await page.getByTestId('task-recur-row').click();
    await page.getByTestId('recur-mode-afterCompletion').click();
    await page.getByTestId('recur-interval').fill('3');
    await page.getByTestId('recur-save').click();
  });
  await addTask('file taxes', async () => {
    const d = new Date();
    d.setDate(d.getDate() + 2);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    await page.getByTestId('task-deadline-input').fill(key);
    await page.getByTestId('task-estimate-input').fill('4');
  });
  await page.screenshot({ path: 'screenshots/02-list.png', fullPage: true });
  await page.getByTestId('back').click();

  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Side quests');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('learn the accordion');
  await page.getByTestId('priority-someday').click();
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await page.waitForTimeout(900); // let the slot-machine settle + sheen pass
  await page.screenshot({ path: 'screenshots/03-randomizer.png', fullPage: true });
  await page.getByTestId('draw-accept').click();

  await page.getByTestId('current-task-card').waitFor();
  await page.waitForTimeout(400);
  await page.screenshot({ path: 'screenshots/01-home.png', fullPage: true });
});
