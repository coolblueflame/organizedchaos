import { expect, test, type Page } from '@playwright/test';

/**
 * The den: the companion's room, opened by a letter once a library reaches
 * the dragon rung. A big library is seeded straight into storage, because
 * finishing 250 tasks through the UI would take minutes.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'den flows on chromium');

/**
 * A fresh library with `completed` finished tasks and saved delight state.
 * The birthday question is always answered up front: a library this size
 * would otherwise have it waiting in the mailbox too, and these tests are
 * about the den's own letter.
 */
async function seedLibrary(page: Page, completed: number, eggState?: Record<string, unknown>) {
  await page.goto('./');
  await page.evaluate(() => new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('organizedchaos');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.reload();
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Done things');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('back').click();
  const listId = (await page.getByTestId(/^list-row-/).first().getAttribute('data-testid'))!.replace('list-row-', '');
  await page.evaluate(({ listId, completed, eggState }) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('organizedchaos');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction(['tasks', 'kv'], 'readwrite');
      const tasks = tx.objectStore('tasks');
      const now = Date.now();
      for (let i = 0; i < completed; i++) {
        const at = now - (i + 1) * 60_000;
        tasks.put({
          id: `done-${i}`, listId, name: `finished ${i}`, notes: '', tagIds: [], priority: 'medium',
          inProgress: false, createdAt: at - 60_000, updatedAt: at, completedAt: at, deleted: false,
        });
      }
      tx.objectStore('kv').put({ key: 'eggState', value: {
        seen: {}, trivia: { correct: 0, total: 0 }, unlocks: [], storyStage: 0,
        lastPresentedAt: 0, presentedDay: '', presentedToday: 0, lastCompletionDay: '', streakDays: 0,
        ...eggState,
        marks: { 'birthday:none': 1, ...(eggState?.marks as Record<string, number> | undefined) },
      } });
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), { listId, completed, eggState });
  await page.reload();
  await page.getByTestId('new-list').waitFor();
}

/** The delight ledger as saved, for checking a mark landed before a reload. */
async function savedMarks(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => new Promise<Record<string, number>>((resolve) => {
    const open = indexedDB.open('organizedchaos');
    open.onsuccess = () => {
      const req = open.result.transaction('kv').objectStore('kv').get('eggState');
      req.onsuccess = () => resolve((req.result?.value?.marks ?? {}) as Record<string, number>);
    };
  }));
}

/** Press and hold the companion long enough to count as a hold. */
async function holdCompanion(page: Page, ms: number) {
  const box = (await page.getByTestId('companion').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.waitForTimeout(ms);
  await page.mouse.up();
}

test('below the dragon rung there is no letter, no door and no way in', async ({ page }) => {
  await seedLibrary(page, 249);
  await expect(page.getByTestId('companion')).toBeVisible();
  await expect(page.getByTestId('mailbox-chip')).toHaveCount(0);
  await holdCompanion(page, 900);
  await expect(page.getByTestId('den')).toHaveCount(0);
  await page.goto('./#/stats');
  await expect(page.getByTestId('discoveries')).toBeVisible();
  await expect(page.getByTestId('stats-den-link')).toHaveCount(0);
  await page.goto('./#/den');
  await expect(page.getByTestId('den-locked')).toBeVisible();
});

test('the den arrives as a letter, and afterwards opens from the companion', async ({ page }) => {
  await seedLibrary(page, 250);
  await page.getByTestId('mailbox-chip').click();
  await page.getByTestId('mailbox-item-den').click();
  await expect(page.getByTestId('den')).toBeVisible();
  await expect(page.getByTestId('den-welcome')).toBeVisible();
  await page.getByTestId('den-welcome-ok').click();
  await expect(page.getByTestId('den-welcome')).toHaveCount(0);

  // Read once, gone everywhere: the letter does not wait for a second reading.
  await expect.poll(async () => Object.keys(await savedMarks(page)).filter((k) => !k.startsWith('birthday:')).sort())
    .toEqual(['den:welcomed', 'mail:den']);
  await page.reload();
  await expect(page.getByTestId('den')).toBeVisible();
  await expect(page.getByTestId('den-welcome'), 'the welcome is read once').toHaveCount(0);
  await page.getByTestId('back').click();
  await expect(page.getByTestId('mailbox-chip')).toHaveCount(0);

  // A tap is still a poke; only a hold goes inside.
  await page.getByTestId('companion').click();
  await expect(page.getByTestId('den')).toHaveCount(0);
  await holdCompanion(page, 900);
  await expect(page.getByTestId('den')).toBeVisible();

  await page.goto('./#/stats');
  await page.getByTestId('stats-den-link').click();
  await expect(page.getByTestId('den')).toBeVisible();
});

test('a duel won with loaded dice is remembered, and earns a hat worth wearing home', async ({ page }) => {
  await seedLibrary(page, 250, { marks: { 'mail:den': 1, 'den:welcomed': 1 } });
  await page.goto('./#/den');
  await expect(page.getByTestId('trinket-tophat'), 'not yet earned').not.toHaveAttribute('aria-pressed');

  await page.evaluate(() => localStorage.setItem('OC_DUEL_DICE', '6,6,6,6,6'));
  await page.getByTestId('duel-start').click();
  for (let i = 1; i <= 5; i++) {
    await page.getByTestId('duel-roll').click();
    await expect(page.getByTestId('duel-pot')).toHaveText(String(6 * i));
  }
  await page.getByTestId('duel-bank').click();
  await expect(page.getByTestId('duel-result')).toHaveText('you win!');
  await expect(page.getByTestId('duel-you')).toHaveText('30');
  await page.getByTestId('duel-leave').click();
  await expect(page.getByTestId('duel-record')).toHaveText('won 1 of 1');

  // The win earned a discovery and a trinket; wearing it shows on Home.
  await page.getByTestId('trinket-tophat').click();
  await expect(page.getByTestId('trinket-tophat')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('den-worn')).toHaveText('🎩');
  await page.getByTestId('back').click();
  await expect(page.getByTestId('companion-trinket')).toHaveText('🎩');
  await page.goto('./#/stats');
  await expect(page.getByTestId('discoveries')).toContainText('House Rules');
});

test('after a bust ENTROPY plays its own turn, then hands the die back', async ({ page }) => {
  await seedLibrary(page, 250, { marks: { 'mail:den': 1, 'den:welcomed': 1 } });
  await page.goto('./#/den');
  // The reader busts at once; ENTROPY rolls 6s until its nerve (6 to 14) says bank.
  await page.evaluate(() => localStorage.setItem('OC_DUEL_DICE', '1,6,6,6,6'));
  await page.getByTestId('duel-start').click();
  await page.getByTestId('duel-roll').click();
  await expect(page.getByTestId('duel-die')).toHaveAttribute('data-face', '1');
  await expect(page.getByTestId('duel-roll')).toBeDisabled();
  await expect(page.getByTestId('duel-entropy')).toHaveText(/^(6|12|18)$/, { timeout: 15_000 });
  await expect(page.getByTestId('duel-roll')).toBeEnabled();
  await expect(page.getByTestId('duel-you')).toHaveText('0');
});

test('the scrapbook shows what has been seen, replays it, and keeps the rest a mystery', async ({ page }) => {
  await seedLibrary(page, 250, { marks: { 'mail:den': 1, 'den:welcomed': 1, 'moment:aurora': 5 } });
  await page.goto('./#/den');
  await expect(page.getByTestId('scrapbook-count')).toHaveText(/^1 of \d+$/);
  await expect(page.getByTestId('scrapbook-disco')).toContainText('???');
  await page.getByTestId('scrapbook-aurora').click();
  const moment = page.getByTestId('delight-moment');
  await expect(moment).toBeVisible();
  await expect(moment).toHaveClass(/m-aurora/);
});
