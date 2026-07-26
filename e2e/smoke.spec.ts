import { expect, test } from '@playwright/test';

test('app shell boots with theme and wordmark', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('Organized Chaos');
  await expect(page.getByRole('heading', { name: /organized\s*chaos/i })).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(11, 14, 20)'); // --bg0 — proves the theme CSS actually loaded
});
