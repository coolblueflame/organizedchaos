import { readFileSync } from 'node:fs';
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
  // Finishing something is what earns a quiz — navigation no longer summons
  // anything at all (2026-09-02).
  await completeOne(page);
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

test('wandering around the app summons nothing', async ({ page }) => {
  // 2026-09-02: "reserve them for completing tasks — it feels odd when they
  // pop up randomly". A forced fact is the strongest possible test: even the
  // entry that automation is TOLD to fire cannot ride a screen visit.
  await reset(page, 'fact');
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Wander');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('back').click();
  await page.getByTestId('stats-strip').click();
  await page.getByTestId('back').click();
  await page.getByTestId('settings-link').click();
  await page.getByTestId('back').click();
  await expect(page.getByTestId('delight-note'), 'browsing is not a completion')
    .toHaveCount(0);
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

test('a story beat waits for OK — nothing else can take it', async ({ page }) => {
  // 2026-08-29: a beat appeared, the app was backgrounded, and it was gone
  // for good. Beats are finite and once-only, so this one holds the screen
  // until it is acknowledged. (The forced beat fires on app-open, so the
  // dialog is already up — and everything behind it is deliberately
  // unreachable, which is the feature.)
  await reset(page, 'story-0');
  await expect(page.getByTestId('delight-story')).toBeVisible();

  // Every other delight surface yields to the next tap anywhere; this must
  // not — not even a tap on its own backdrop, well past the protected window.
  await page.waitForTimeout(3200);
  await page.getByTestId('delight-story').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('delight-story'), 'still there, still unread').toBeVisible();

  // A reload cannot swallow it either: the debt outlives the session.
  await page.reload();
  await expect(page.getByTestId('delight-story')).toBeVisible();

  // OK is the only way out, and only then does the story move on.
  await page.getByTestId('delight-story-ok').click();
  await expect(page.getByTestId('delight-story')).toHaveCount(0);
  const stage = await page.evaluate(() => new Promise<number>((resolve, reject) => {
    const open = indexedDB.open('organizedchaos');
    open.onsuccess = () => {
      const req = open.result.transaction('kv').objectStore('kv').get('eggState');
      req.onsuccess = () => resolve((req.result?.value as { storyStage?: number })?.storyStage ?? 0);
      req.onerror = () => reject(req.error);
    };
    open.onerror = () => reject(open.error);
  }));
  expect(stage, 'acknowledged, so the story moved on').toBe(1);
});

test('every moment renders on demand without throwing', async ({ page }) => {
  /*
    The registry guard proves each moment NAME is handled; this proves each
    one actually draws. A canvas branch that throws leaves the overlay blank
    and the page error goes nowhere a human would see — so the names come
    straight from the registry source and every one is forced in turn.
  */
  const src = readFileSync(new URL('../src/lib/eggs/registry.ts', import.meta.url), 'utf8');
  const block = src.slice(src.indexOf('export const MOMENTS'), src.indexOf('] as const;'));
  const names = [...block.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]!);
  expect(names.length).toBeGreaterThan(10);

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await reset(page);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Moments');
  await page.getByTestId('new-list-input').press('Enter');
  for (const name of names) {
    await page.evaluate(([n]) => {
      localStorage.setItem('OC_EGG_FORCE', 'moment');
      localStorage.setItem('OC_MOMENT', n!);
    }, [name]);
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-name-input').fill(name);
    await page.getByTestId('task-collapse').last().click();
    const row = page.getByTestId(/^task-row-/).first();
    const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
    await page.getByTestId(`task-check-${id}`).click();
    const moment = page.getByTestId('delight-moment');
    await expect(moment, name).toBeVisible();
    await expect(moment, name).toHaveClass(new RegExp(`m-${name}`));
    // Tapping the effect itself is a deliberate dismissal, honoured at once.
    await moment.click();
    await expect(moment).toHaveCount(0);
  }
  expect(errors).toEqual([]);
});
