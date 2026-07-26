import { expect, test } from '@playwright/test';

/**
 * Offline-first proof: after one online visit installs the service worker,
 * the app must boot with the network fully cut. Chromium-only (webkit's SW
 * support in Playwright is not representative of real Safari here).
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'SW offline check on chromium');
test.use({ serviceWorkers: 'allow' });

test('service worker serves the whole app offline', async ({ page, context }) => {
  await page.goto('./');
  await page.getByTestId('new-list').waitFor();
  // Controlled ⇒ install (and thus the whole precache) finished and this page's
  // fetches route through the SW — the only state where offline is guaranteed.
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, undefined, { timeout: 30_000 });

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByTestId('new-list')).toBeVisible(); // full app, zero network
  await context.setOffline(false);
});

test('manifest is served and points at real icons', async ({ page, request }) => {
  await page.goto('./');
  const href = await page.getAttribute('link[rel="manifest"]', 'href');
  expect(href).toBeTruthy();
  const manifest = await (await request.get(new URL(href!, page.url()).toString())).json();
  expect(manifest.display).toBe('standalone');
  for (const icon of manifest.icons as Array<{ src: string }>) {
    const res = await request.get(new URL(icon.src, page.url()).toString());
    expect(res.status(), icon.src).toBe(200);
  }
});
