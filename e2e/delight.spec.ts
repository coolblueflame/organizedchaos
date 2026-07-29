import { expect, test } from '@playwright/test';

/**
 * Delight-layer flows via the forced-entry hook (delight is otherwise silent
 * under automation). Chromium-only; the layer is engine-agnostic.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'delight flows on chromium');

async function reset(page: import('@playwright/test').Page, force?: string) {
  await page.goto('./');
  await page.evaluate(
    ([f]) =>
      new Promise<void>((resolve) => {
        if (f) localStorage.setItem('OC_EGG_FORCE', f);
        else localStorage.removeItem('OC_EGG_FORCE');
        const req = indexedDB.deleteDatabase('organizedchaos');
        req.onsuccess = req.onerror = req.onblocked = () => resolve();
      }),
    [force],
  );
  await page.reload();
  await page.getByTestId('new-list').waitFor();
}

async function completeOne(page: import('@playwright/test').Page) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Eggy');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('hatch');
  await page.getByTestId('task-collapse').click();
  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${id}`).click();
}

test('a forced note appears on completion and dismisses on tap', async ({ page }) => {
  await reset(page, 'fact');
  await completeOne(page);
  await expect(page.getByTestId('delight-note')).toBeVisible();
  await page.getByTestId('delight-note').click();
  await expect(page.getByTestId('delight-note')).toHaveCount(0);
});

test('trivia records the score and shows in discoveries', async ({ page }) => {
  await reset(page, 'trivia');
  // trivia triggers on screen visits — the first post-boot navigation fires it
  await page.getByTestId('settings-link').click();
  await expect(page.getByTestId('delight-trivia')).toBeVisible();
  await page.getByTestId('trivia-choice-0').click(); // right or wrong — both record
  await page.getByTestId('trivia-close').click();
  await expect(page.getByTestId('delight-trivia')).toHaveCount(0);

  // The score and the discoveries list live on the stats screen now — that is
  // where wins are celebrated, rather than buried in settings.
  await page.getByTestId('back').click();
  await page.getByTestId('stats-strip').click();
  await expect(page.getByText(/Quiz score: [01]\/1/)).toBeVisible();
  await expect(page.getByTestId('discoveries')).toContainText('???');
});

test('unforced automation runs stay completely delight-free', async ({ page }) => {
  await reset(page);
  await completeOne(page);
  await expect(page.getByTestId('delight-note')).toHaveCount(0);
  await expect(page.getByTestId('delight-trivia')).toHaveCount(0);
});

test('the bonus draw persists nothing unless accepted', async ({ page }) => {
  await reset(page, 'selfcare');
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Pool');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('regular task');
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-selfcare')).toBeVisible();
  await page.getByTestId('selfcare-skip').click();       // skip → no trace
  await expect(page.getByTestId('draw-card')).toBeVisible();
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(1); // only the regular task

  // Accept path DOES create it — as the current task.
  await page.getByTestId('back').click();
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-selfcare')).toBeVisible();
  await page.getByTestId('selfcare-accept').click();
  await expect(page.getByTestId('current-task-card')).toContainText('water');

  // It lands in the dice's own vessel, not the user's list — a trailing
  // "summoned" section that exists only while its work is open…
  await expect(page.getByTestId('generated-header')).toBeVisible();
  await expect(page.getByText('self-care', { exact: true })).toBeVisible();
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(/^task-row-/), 'the user list is untouched').toHaveCount(1);
  await page.getByTestId('back').click();

  // …and vanishes the moment the last generated task is done.
  await page.getByTestId('current-complete').click();
  await expect(page.getByTestId('current-task-card')).toHaveCount(0);
  await expect(page.getByTestId('generated-header')).toHaveCount(0);
});

test('a note waits to be read instead of expiring on a timer', async ({ page }) => {
  // Reported 2026-07-28: a note vanished while the app was backgrounded, so
  // reopening it to read the thing showed nothing. Notes now wait for the user.
  await reset(page, 'fact');
  await completeOne(page);
  await expect(page.getByTestId('delight-note')).toBeVisible();

  // Far longer than any old lifetime; it is still there.
  await page.waitForTimeout(9000);
  await expect(page.getByTestId('delight-note')).toBeVisible();

  // Interacting elsewhere clears it — the tap does its own job as well.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('delight-note')).toHaveCount(0);
});

test('a tap that was already in flight cannot wipe a note unread', async ({ page }) => {
  await reset(page, 'fact');
  await completeOne(page);
  await expect(page.getByTestId('delight-note')).toBeVisible();

  // Immediately poking elsewhere is treated as incidental, not a dismissal.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('delight-note')).toBeVisible();
});
