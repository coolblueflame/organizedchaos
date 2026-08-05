import { expect, test, type Page } from '@playwright/test';

/**
 * Add-to-home-screen guidance. The webkit project runs a real iPhone user
 * agent, so it exercises the iOS copy; chromium stands in for desktop. The
 * banner is opt-in under automation (OC_INSTALL_BANNER) — see install.svelte.ts.
 */
async function reset(page: Page, showBanner = false) {
  await page.goto('./');
  await page.evaluate(
    ([show]) =>
      new Promise<void>((resolve) => {
        localStorage.removeItem('oc-install-dismissed');
        if (show) localStorage.setItem('OC_INSTALL_BANNER', '1');
        else localStorage.removeItem('OC_INSTALL_BANNER');
        const req = indexedDB.deleteDatabase('organizedchaos');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
    [showBanner],
  );
  await page.reload();
  await page.getByTestId('new-list').waitFor();
}

test('the how-to is reachable from settings and names the right platform', async ({
  page, browserName,
}) => {
  await reset(page);
  await page.getByTestId('settings-link').click();
  await page.getByTestId('install-howto-open').click();
  await expect(page.getByTestId('install-howto')).toBeVisible();

  // iPhone-sized webkit gets the Safari share-sheet route; chromium the desktop one.
  const steps = browserName === 'webkit' ? 'install-steps-ios' : 'install-steps-desktop';
  await expect(page.getByTestId(steps)).toBeVisible();
  if (browserName === 'webkit') {
    await expect(page.getByTestId('install-steps-ios')).toContainText('Add to Home Screen');
  } else {
    // The desktop copy must SAY desktop things. Ben scanned for Dock/taskbar
    // words on his Mac, found only "home screen" phrasing, and concluded the
    // instructions didn't exist (2026-08-06) — they did, dressed as a phone's.
    await expect(page.getByTestId('install-howto')).toContainText('install it as an app');
    await expect(page.getByTestId('install-steps-desktop')).toContainText('Add to Dock');
  }

  await page.getByTestId('install-howto-close').click();
  await expect(page.getByTestId('install-howto')).toHaveCount(0);
});

test('the banner opens the how-to and stays gone once dismissed', async ({
  page, browserName,
}) => {
  test.skip(browserName !== 'webkit', 'the nudge targets phones');
  await reset(page, true);

  await expect(page.getByTestId('install-banner')).toBeVisible();
  await page.getByTestId('install-banner-how').click();
  await expect(page.getByTestId('install-howto')).toBeVisible();
  await page.getByTestId('install-howto-close').click();

  await page.getByTestId('install-banner-dismiss').click();
  await expect(page.getByTestId('install-banner')).toHaveCount(0);
  // …and it does not come back on the next launch.
  await page.reload();
  await page.getByTestId('new-list').waitFor();
  await expect(page.getByTestId('install-banner')).toHaveCount(0);
});

test('no install nudge interferes with the normal mobile flow', async ({ page }) => {
  // Regression guard: the nudge used to be a bottom-fixed bar, which would
  // have covered the undo toast, the bulk bar and "+ new todo".
  await reset(page);
  await expect(page.getByTestId('install-banner')).toHaveCount(0);
  await expect(page.getByTestId('big-button')).toBeVisible();
});
