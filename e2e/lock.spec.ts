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

async function seedList(page: import('@playwright/test').Page, title: string, task: string) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill(title);
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill(task);
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();
}

test('a locked list hides its contents everywhere until the PIN opens it', async ({ page }) => {
  await seedList(page, 'Groceries', 'buy milk');
  await seedList(page, 'Secrets', 'plan the surprise party');

  // Set the PIN, then lock "Secrets" from its settings sheet.
  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-pin-input').fill('1234');
  await page.getByTestId('settings-pin-save').click();
  await page.getByTestId('back').click();
  const secretsRow = page.getByTestId(/^list-row-/).filter({ hasText: 'Secrets' });
  const listId = (await secretsRow.getAttribute('data-testid'))!.replace('list-row-', '');
  await page.getByTestId(`list-menu-${listId}`).click();
  await page.getByTestId('list-settings-lock').click();
  await expect(secretsRow.locator('.locked-mark')).toBeVisible(); // the mirror took it

  // Setting the PIN unlocked the session; "lock now" re-arms it without a
  // reload — a reload HERE would race the just-fired IndexedDB write (the
  // exact scheduling bet CI collects; it did, once).
  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-lock-now').click();
  await page.getByTestId('back').click();

  // Search cannot see it…
  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('surprise');
  await expect(page.getByTestId('search-empty')).toBeVisible();
  await page.getByTestId('back').click();

  // …and opening the list hits the gate, with the contents absent.
  await secretsRow.locator('.list-main').click();
  await expect(page.getByTestId('lock-gate')).toBeVisible();
  await expect(page.getByText('surprise party')).toHaveCount(0);

  // A wrong PIN bounces; the right one opens the whole session.
  await page.getByTestId('lock-pin-input').fill('9999');
  await page.getByTestId('lock-unlock').click();
  await expect(page.getByTestId('lock-wrong')).toBeVisible();
  await page.getByTestId('lock-pin-input').fill('1234');
  await page.getByTestId('lock-unlock').click();
  await expect(page.getByText('plan the surprise party')).toBeVisible();

  // Unlocked session: search finds it again.
  await page.getByTestId('back').click();
  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('surprise');
  await expect(page.getByText('plan the surprise party')).toBeVisible();
  await page.getByTestId('back').click();

  // Complete the secret task while unlocked — celebration surfaces must not
  // read its name back out once the app relocks.
  await secretsRow.locator('.list-main').click();
  const row = page.getByTestId(/^task-row-/).first();
  const taskId = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${taskId}`).click();
  await expect(page.getByTestId(`task-row-${taskId}`)).toHaveCount(0);
  await page.getByTestId('back').click();
  await page.goto('./#/week');
  await expect(page.getByTestId('week-wins')).toContainText('surprise party'); // unlocked: fine

  await page.goto('./#/');
  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-lock-now').click();
  await page.getByTestId('back').click();
  await page.goto('./#/week');
  await expect(page.getByTestId('week-wins')).toHaveCount(0); // its only win is sealed
  await page.goto('./#/');

  // Persistence: by now the locked flag has long since hit disk — a fresh
  // load re-arms the session and the flag survives.
  await page.reload();
  await secretsRow.locator('.list-main').click();
  await expect(page.getByTestId('lock-gate')).toBeVisible();
});

test('the vault padlock opens and shuts the private lists right at the dice', async ({ page }) => {
  // 2026-08-20 ask: unlocking used to mean navigating INTO a locked list
  // first; the padlock now sits beside the sort row and the randomizer
  // title, one tap from the roll.
  await seedList(page, 'Secrets', 'plan the surprise party');
  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-pin-input').fill('1234');
  await page.getByTestId('settings-pin-save').click();
  await page.getByTestId('back').click();
  const secretsRow = page.getByTestId(/^list-row-/).filter({ hasText: 'Secrets' });
  const listId = (await secretsRow.getAttribute('data-testid'))!.replace('list-row-', '');
  await page.getByTestId(`list-menu-${listId}`).click();
  await page.getByTestId('list-settings-lock').click();
  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-lock-now').click();
  await page.getByTestId('back').click();

  // Locked: the dice can't serve the vault's only task.
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible();

  // The padlock in the randomizer's own header opens the gate; the pool
  // refreshes the moment the PIN lands — no leaving the screen.
  await page.getByTestId('vault-toggle').click();
  await page.getByTestId('lock-pin-input').fill('1234');
  await page.getByTestId('lock-unlock').click();
  await expect(page.getByTestId('draw-card')).toContainText('surprise party');

  // One tap shuts it again, and the pool empties with it.
  await page.getByTestId('vault-toggle').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible();

  // Home carries the same padlock, beside the sort row.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('vault-toggle')).toBeVisible();
});

test('a locked list keeps its names out of the recurring, rituals and blocker surfaces', async ({ page }) => {
  // Reported 2026-08-30: recurring rules from a locked list showed their
  // names on the Recurring screen while the app was locked. The same gap
  // existed in two siblings — the rituals screen and the blocked-by picker,
  // where typing letters would have searched hidden titles outright.
  await seedList(page, 'Errands', 'buy milk');
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Secrets');
  await page.getByTestId('new-list-input').press('Enter');

  // A recurring rule and a ritual, both inside what will become the vault.
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('the secret weekly thing');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill('3');
  await page.getByTestId('recur-save').click();
  await page.getByTestId('task-collapse').last().click();

  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('the secret daily thing');
  await page.getByTestId('task-ritual-row').click();
  await page.getByTestId('ritual-from').fill('00:00');
  await page.getByTestId('ritual-to').fill('23:59');
  await page.getByTestId('ritual-save').click();
  await page.getByTestId('task-collapse').last().click();
  await page.getByTestId('back').click();

  // Set the PIN, lock the list, then relock the session.
  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-pin-input').fill('1234');
  await page.getByTestId('settings-pin-save').click();
  await page.getByTestId('back').click();
  const secrets = page.getByTestId(/^list-row-/).filter({ hasText: 'Secrets' });
  const listId = (await secrets.getAttribute('data-testid'))!.replace('list-row-', '');
  await page.getByTestId(`list-menu-${listId}`).click();
  await page.getByTestId('list-settings-lock').click();
  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-lock-now').click();
  await page.getByTestId('back').click();

  // Recurring screen: the rule is hidden while locked.
  await page.getByTestId('recurring-link').click();
  await expect(page.getByText('the secret weekly thing')).toHaveCount(0);
  await page.getByTestId('back').click();

  // Rituals screen: same rule, same silence.
  await page.getByTestId('rituals-link').click();
  await expect(page.getByText('the secret daily thing')).toHaveCount(0);
  await page.getByTestId('back').click();

  // And the blocked-by picker must not search what the PIN is hiding.
  await page.getByTestId(/^list-row-/).filter({ hasText: 'Errands' }).click();
  await page.getByText('buy milk', { exact: true }).click();
  await page.getByTestId('blocked-by-toggle').click();
  await page.getByTestId('blocked-by-input').fill('secret');
  await page.waitForTimeout(300); // the picker answers a beat after typing
  await expect(page.getByTestId(/^blocked-by-pick-/)).toHaveCount(0);
});
