import { expect, test, type Page } from '@playwright/test';

/**
 * ENTROPY's sparkles: one hidden somewhere each app-day, found by tapping.
 * Under automation the hunt is silent unless a test names the spot to hide
 * on (OC_SPARKLE), so these tests choose the screen rather than the date.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'sparkle flows on chromium');

async function reset(page: Page, spot: string | null) {
  await page.goto('./');
  await page.evaluate(() => new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('organizedchaos');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.evaluate((s) => {
    if (s) localStorage.setItem('OC_SPARKLE', s);
    else localStorage.removeItem('OC_SPARKLE');
  }, spot);
  await page.reload();
  await page.getByTestId('new-list').waitFor();
}

async function savedMarks(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => new Promise<Record<string, number>>((resolve) => {
    const open = indexedDB.open('organizedchaos');
    open.onsuccess = () => {
      const req = open.result.transaction('kv').objectStore('kv').get('eggState');
      req.onsuccess = () => resolve((req.result?.value?.marks ?? {}) as Record<string, number>);
    };
  }));
}

test('a sparkle hides on its screen only, and once found stays found for the day', async ({ page }) => {
  await reset(page, 'stats');
  await expect(page.getByTestId('sparkle'), 'not on Home today').toHaveCount(0);
  await page.goto('./#/settings');
  await expect(page.getByTestId('back')).toBeVisible();
  await expect(page.getByTestId('sparkle'), 'not in Settings today').toHaveCount(0);

  await page.goto('./#/stats');
  await page.getByTestId('sparkle').click();
  await expect(page.getByTestId('sparkle')).toHaveCount(0);
  const note = page.getByTestId('delight-note');
  await expect(note).toBeVisible();
  await expect(note).toContainText('the first');

  await expect.poll(async () => Object.keys(await savedMarks(page)).filter((k) => k.startsWith('sparkle:')))
    .toHaveLength(1);
  await page.reload();
  await expect(page.getByTestId('back')).toBeVisible();
  await expect(page.getByTestId('sparkle'), 'found is found until tomorrow').toHaveCount(0);
  await expect(page.getByTestId('discoveries')).toContainText('Finders Keepers');
});

test('the hunt can hide on Home without crowding the mailbox', async ({ page }) => {
  await reset(page, 'home');
  const sparkle = page.getByTestId('sparkle');
  await expect(sparkle).toBeVisible();
  const tagline = (await page.locator('.tagline').boundingBox())!;
  const box = (await sparkle.boundingBox())!;
  // Beside the tagline, on its line.
  expect(box.x).toBeGreaterThanOrEqual(tagline.x + tagline.width - 1);
  expect(box.x - (tagline.x + tagline.width), 'right beside it, not at the far end').toBeLessThan(12);
  expect(Math.abs(box.y + box.height / 2 - (tagline.y + tagline.height / 2))).toBeLessThan(12);
});
