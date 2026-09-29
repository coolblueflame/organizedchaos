import { expect, test, type Page } from '@playwright/test';
import { STORY_BEATS } from '../src/lib/eggs/content/extras';

/**
 * The story so far: rereading what has been told, and nothing further.
 * Progress is seeded straight into the engine's saved state, the same way
 * the streak tests do, because earning beats takes days of real use.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'story flows on chromium');

async function seedStory(page: Page, storyStage: number) {
  await page.goto('./');
  await page.evaluate(() => new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase('organizedchaos');
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  }));
  await page.reload();
  await page.getByTestId('new-list').waitFor();
  await page.evaluate((stage) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('organizedchaos');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('kv', 'readwrite');
      tx.objectStore('kv').put({ key: 'eggState', value: {
        seen: {}, trivia: { correct: 0, total: 0 }, unlocks: [], storyStage: stage,
        lastPresentedAt: 0, presentedDay: '', presentedToday: 0,
        lastCompletionDay: '', streakDays: 0,
      } });
      tx.oncomplete = () => { req.result.close(); resolve(); };
      tx.onerror = () => reject(tx.error);
    };
  }), storyStage);
  await page.reload();
  await page.getByTestId('new-list').waitFor();
}

test('before the story begins, its page is not even offered', async ({ page }) => {
  await seedStory(page, 0);
  await page.goto('./#/stats');
  await expect(page.getByTestId('discoveries')).toBeVisible();
  await expect(page.getByTestId('stats-story-link')).toHaveCount(0);
});

test('the story so far shows every beat read, and not one beat further', async ({ page }) => {
  const read = 3;
  await seedStory(page, read);
  await page.goto('./#/stats');
  await page.getByTestId('stats-story-link').click();
  await expect(page).toHaveURL(/#\/story$/);
  const beats = page.getByTestId('story-beat');
  await expect(beats).toHaveCount(read);
  for (let i = 0; i < read; i++) await expect(beats.nth(i)).toHaveText(STORY_BEATS[i]!);
  // The next beat is the reader's to be told, not to find here.
  await expect(page.locator('main')).not.toContainText(STORY_BEATS[read]!);
  await expect(page.getByTestId('story-coda')).toHaveText('to be continued.');
});

test('the story so far returns to Stats, by ‹ and by Escape alike', async ({ page }) => {
  await seedStory(page, 2);
  await page.goto('./#/story');
  await page.keyboard.press('Escape');
  await expect(page).toHaveURL(/#\/stats$/);
  await page.getByTestId('stats-story-link').click();
  await page.getByTestId('back').click();
  await expect(page).toHaveURL(/#\/stats$/);
});

test('the week and Wrapped leave by the same door as their ‹', async ({ page }) => {
  // Their ‹ has always pointed at Stats while Escape went home.
  await seedStory(page, 0);
  for (const screen of ['week', 'wrapped']) {
    await page.goto(`./#/${screen}`);
    await page.getByTestId('back').waitFor();
    await page.keyboard.press('Escape');
    await expect(page, screen).toHaveURL(/#\/stats$/);
  }
});
