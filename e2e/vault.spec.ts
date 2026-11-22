import { expect, test, type Page } from '@playwright/test';

/**
 * The little door in the den's notebook, and the room behind it. A big
 * library is seeded straight into storage, because finishing 250 tasks
 * through the UI would take minutes.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'vault flows on chromium');

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

/** Saved discoveries, for checking a grant landed. */
async function savedUnlocks(page: Page): Promise<string[]> {
  return page.evaluate(() => new Promise<string[]>((resolve) => {
    const open = indexedDB.open('organizedchaos');
    open.onsuccess = () => {
      const req = open.result.transaction('kv').objectStore('kv').get('eggState');
      req.onsuccess = () => resolve((req.result?.value?.unlocks ?? []) as string[]);
    };
  }));
}

const inDen = { 'mail:den': 1, 'den:welcomed': 1 };

test('no door in the margin until the key’s riddle is solved; the room says it is shut', async ({ page }) => {
  await seedLibrary(page, 250, { marks: inDen });
  await page.goto('./#/den');
  await expect(page.getByTestId('notebook')).toBeVisible();
  await expect(page.getByTestId('notebook-door')).toHaveCount(0);
  await page.goto('./#/vault');
  await expect(page.getByTestId('vault-locked')).toBeVisible();
  await expect(page.getByTestId('vault-kevin')).toHaveCount(0);
});

test('the door stays locked until the companion holds the key, then opens onto the vault', async ({ page }) => {
  await seedLibrary(page, 250, { marks: { ...inDen, 'riddle:keys': 1 } });
  await page.goto('./#/den');
  await page.getByTestId('notebook-door').click();
  await expect(page.getByTestId('notebook-door-note')).toContainText('locked');
  await expect(page).toHaveURL(/#\/den$/);
  await expect(page.getByTestId('trinket-idea-hat'), 'the prize behind it is still a mystery').toHaveAttribute('aria-label', /^locked/);

  await page.getByTestId('trinket-key').click();
  await page.getByTestId('notebook-door').click();
  await expect(page).toHaveURL(/#\/vault$/);
  await expect(page.getByTestId('vault-count')).toHaveText('2 of 14');
  await expect(page.getByTestId('vault-find')).toHaveCount(2);
  expect(await savedUnlocks(page)).toContain('little-door');

  // Back in the den, the door stays open without the key, and the prize is on the shelf.
  await page.getByTestId('back').click();
  await expect(page).toHaveURL(/#\/den$/);
  await page.getByTestId('trinket-key').click();
  await expect(page.getByTestId('den-worn-held')).toHaveCount(0);
  await page.getByTestId('trinket-idea-hat').click();
  await expect(page.getByTestId('den-worn-head')).toHaveText('💭');
  await page.getByTestId('notebook-door').click();
  await expect(page).toHaveURL(/#\/vault$/);
  await page.keyboard.press('Escape');
  await expect(page, 'Escape steps back to the den, like the ‹').toHaveURL(/#\/den$/);
});

test('Kevin moves once, after enough patience in one visit', async ({ page }) => {
  await seedLibrary(page, 250, { marks: { ...inDen, 'riddle:keys': 1, 'vault:opened': 1 } });
  await page.goto('./#/vault');
  const kevin = page.getByTestId('vault-kevin');
  for (let i = 0; i < 9; i++) await kevin.click();
  await expect(page.getByTestId('vault-caption')).not.toContainText('MOVED');
  expect(await savedUnlocks(page)).not.toContain('kevin-moved');
  await kevin.click();
  await expect(page.getByTestId('vault-caption')).toContainText('Kevin MOVED');
  await expect.poll(() => savedUnlocks(page)).toContain('kevin-moved');
  expect((await savedMarks(page))['kevin:moved']).toBeDefined();
  await kevin.click();
  await expect(page.getByTestId('vault-caption'), 'afterwards the room admits it').not.toHaveText('Kevin is very still.');
});

test('a visit in a new week turns up one more lost thing, once', async ({ page }) => {
  await seedLibrary(page, 250, { marks: { ...inDen, 'riddle:keys': 1, 'vault:opened': 1, 'vault:week:2020-01-06': 1 } });
  await page.goto('./#/vault');
  await expect(page.getByTestId('vault-caption')).toContainText('Kevin found something new');
  await expect(page.getByTestId('vault-count')).toHaveText('3 of 14');
  await expect.poll(async () => Object.keys(await savedMarks(page)).filter((k) => k.startsWith('vault:week:')).length).toBe(2);
  await page.reload();
  await expect(page.getByTestId('vault-count'), 'the same week adds nothing more').toHaveText('3 of 14');
  await expect(page.getByTestId('vault-caption')).toHaveText('Kevin is very still.');
});

test('the bigger crown is a crown with a crown on top', async ({ page }) => {
  await seedLibrary(page, 2000, { marks: inDen });
  await page.goto('./#/den');
  await page.getByTestId('trinket-grand-crown').click();
  const head = page.getByTestId('den-worn-head');
  await expect(head).toHaveClass(/item-grand-crown/);
  const before = await head.evaluate((el) => getComputedStyle(el, '::before').content);
  expect(before).toContain('👑');
});
