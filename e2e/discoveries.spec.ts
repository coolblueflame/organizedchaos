import { expect, test, type Page } from '@playwright/test';

/**
 * Discoveries granted by their own flows rather than by the registry's
 * lottery. Under automation the award card stays hidden but the grant is
 * recorded, so the proof is the discoveries list on the stats screen.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'discovery flows on chromium');

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

test('saying the other one’s name in the search box is a discovery', async ({ page }) => {
  await reset(page);
  await page.goto('./#/search');
  await page.getByTestId('search-input').fill('entropy');
  await page.goto('./#/stats');
  await expect(page.getByTestId('discoveries')).toContainText('Named the Other One');
  // Any other word is just a search.
  await reset(page);
  await page.goto('./#/search');
  await page.getByTestId('search-input').fill('entropic');
  await page.goto('./#/stats');
  await expect(page.getByTestId('discoveries')).not.toContainText('Named the Other One');
});

test('clearing the last open task in a list is a discovery, and a lone first task is not', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Shelf');
  await addTask(page, 'first');
  await addTask(page, 'second');
  const rows = page.getByTestId(/^task-row-/);
  await expect(rows).toHaveCount(2);
  const ids = await Promise.all(
    (await rows.all()).map(async (r) => (await r.getAttribute('data-testid'))!.replace('task-row-', '')),
  );
  await page.getByTestId(`task-check-${ids[0]}`).click();
  await expect(rows).toHaveCount(1);
  // One open task left: the shelf is not empty yet.
  await page.goto('./#/stats');
  await expect(page.getByTestId('discoveries')).toContainText('???');
  await expect(page.getByTestId('discoveries')).not.toContainText('Empty Shelf');
  await page.goBack();
  await page.getByTestId(`task-check-${ids[1]}`).click();
  await expect(rows).toHaveCount(0);
  await page.goto('./#/stats');
  await expect(page.getByTestId('discoveries')).toContainText('Empty Shelf');
});
