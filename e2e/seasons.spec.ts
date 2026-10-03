import { expect, test, type Page } from '@playwright/test';

/**
 * Seasons and occasions. Under automation the calendar is ignored and a
 * test names the season in OC_SEASON instead, so these run the same on any
 * date; which dates map to which season is pinned by the unit tests.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'season flows on chromium');

/** A fresh library with enough finished tasks for the companion, in the named season. */
async function seed(page: Page, season: string | null) {
  await page.goto('./');
  await page.evaluate(() => new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('organizedchaos');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.evaluate((s) => {
    if (s) localStorage.setItem('OC_SEASON', s);
    else localStorage.removeItem('OC_SEASON');
  }, season);
  await page.reload();
  await page.getByTestId('new-list').waitFor();
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('organizedchaos');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('tasks', 'readwrite');
      const now = Date.now();
      for (let i = 0; i < 12; i++) {
        tx.objectStore('tasks').put({
          id: `done-${i}`, listId: 'nowhere', name: `finished ${i}`, notes: '', tagIds: [], priority: 'medium',
          inProgress: false, createdAt: now - 1e6, updatedAt: now, completedAt: now - i * 60_000, deleted: false,
        });
      }
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await page.getByTestId('new-list').waitFor();
}

test('an ordinary day looks like itself, with no letter waiting', async ({ page }) => {
  await seed(page, null);
  await expect(page.getByTestId('tagline')).toHaveText('// a todo list with loaded dice');
  await expect(page.getByTestId('companion')).toBeVisible();
  await expect(page.getByTestId('companion-trinket')).toHaveCount(0);
  await expect(page.getByTestId('mailbox-chip')).toHaveCount(0);
});

test('a season dresses Home and the companion, and its letter is read once', async ({ page }) => {
  await seed(page, 'halloween');
  await expect(page.getByTestId('tagline')).toHaveText('// a todo list with haunted dice');
  await expect(page.getByTestId('companion-trinket')).toHaveText('🎃');

  await page.getByTestId('mailbox-chip').click();
  await page.getByTestId('mailbox-item-season').click();
  const moment = page.getByTestId('delight-moment');
  await expect(moment).toHaveClass(/m-eyes-in-the-dark/);
  await moment.click();
  // The letter's words wait behind the moment rather than being lost to it.
  await expect(page.getByTestId('delight-note')).toContainText('decorated');
  await expect(page.getByTestId('mailbox-chip')).toHaveCount(0);

  await expect.poll(() => page.evaluate(() => new Promise<string[]>((resolve) => {
    const open = indexedDB.open('organizedchaos');
    open.onsuccess = () => {
      const req = open.result.transaction('kv').objectStore('kv').get('eggState');
      req.onsuccess = () => resolve(Object.keys(req.result?.value?.marks ?? {}).filter((k) => k.startsWith('mail:season:')));
    };
  }))).toEqual([expect.stringMatching(/^mail:season:halloween-\d{4}$/)]);
  await page.reload();
  await page.getByTestId('new-list').waitFor();
  await expect(page.getByTestId('mailbox-chip'), 'read once, gone for the season').toHaveCount(0);
});

test('seasonal touches can be switched off, and stay off', async ({ page }) => {
  await seed(page, 'winter');
  await expect(page.getByTestId('tagline')).toHaveText('// a todo list with frosted dice');
  await page.goto('./#/settings');
  await page.getByTestId('settings-seasonal').uncheck();
  await page.getByTestId('back').click();
  await expect(page.getByTestId('tagline')).toHaveText('// a todo list with loaded dice');
  await expect(page.getByTestId('companion-trinket')).toHaveCount(0);
  await expect(page.getByTestId('mailbox-chip')).toHaveCount(0);
  // The switch reaches storage asynchronously; reload only once it has.
  await expect.poll(() => page.evaluate(() => new Promise<boolean>((resolve) => {
    const open = indexedDB.open('organizedchaos');
    open.onsuccess = () => {
      const req = open.result.transaction('kv').objectStore('kv').get('eggState');
      req.onsuccess = () => resolve(req.result?.value?.marks?.['seasonal:off'] !== undefined);
    };
  }))).toBe(true);
  await page.reload();
  await page.getByTestId('new-list').waitFor();
  await expect(page.getByTestId('tagline')).toHaveText('// a todo list with loaded dice');
});

test('ENTROPY asks about a birthday once, and a date or a no is kept', async ({ page }) => {
  await seed(page, null);
  // Twelve finished tasks is too new a library to be asked anything.
  await expect(page.getByTestId('mailbox-chip')).toHaveCount(0);
  await page.evaluate(() => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('organizedchaos');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('tasks', 'readwrite');
      const now = Date.now();
      for (let i = 12; i < 50; i++) {
        tx.objectStore('tasks').put({
          id: `done-${i}`, listId: 'nowhere', name: `finished ${i}`, notes: '', tagIds: [], priority: 'medium',
          inProgress: false, createdAt: now - 1e6, updatedAt: now, completedAt: now - i * 60_000, deleted: false,
        });
      }
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }));
  await page.reload();
  await page.getByTestId('mailbox-chip').click();
  await page.getByTestId('mailbox-item-birthday').click();
  await expect(page.getByTestId('birthday-ask')).toBeVisible();

  // "Ask me later" leaves the question waiting.
  await page.getByTestId('birthday-later').click();
  await expect(page.getByTestId('birthday-ask')).toHaveCount(0);
  await page.getByTestId('mailbox-chip').click();
  await page.getByTestId('mailbox-item-birthday').click();

  await page.getByTestId('birthday-month').selectOption('3');
  await page.getByTestId('birthday-day').selectOption('7');
  await page.getByTestId('birthday-save').click();
  await expect(page.getByTestId('birthday-ask')).toHaveCount(0);
  await expect(page.getByTestId('mailbox-chip'), 'answered, so never asked again').toHaveCount(0);

  await page.goto('./#/settings');
  await expect(page.getByTestId('settings-birthday-status')).toHaveText('kept as March 7.');
  await page.getByTestId('settings-birthday-clear').click();
  await expect(page.getByTestId('settings-birthday-status')).toHaveText('not shared.');
  await page.getByTestId('back').click();
  await expect(page.getByTestId('mailbox-chip'), 'taking it back is an answer too').toHaveCount(0);
});
