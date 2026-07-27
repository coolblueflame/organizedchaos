import { expect, test, type Page } from '@playwright/test';

/**
 * Nothing may overflow the viewport horizontally at phone width. A general
 * guard rather than a list of known offenders: the reported deadline/timebox
 * collision was found by eye on a real device, and this is how the next one
 * gets found before shipping.
 */
test.skip(({ browserName }) => browserName !== 'webkit', 'phone-width layout');

async function overflow(page: Page): Promise<number> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
}

/** The widest element sticking out, for a failure message worth reading. */
async function widestOffender(page: Page): Promise<string> {
  return page.evaluate(() => {
    const limit = document.documentElement.clientWidth;
    let worst = '';
    let worstBy = 0;
    for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue;
      const by = Math.max(r.right - limit, -r.left);
      if (by > worstBy) {
        worstBy = by;
        worst = `${el.tagName.toLowerCase()}.${el.className}`.slice(0, 120);
      }
    }
    return worstBy > 1 ? `${worst} (over by ${Math.round(worstBy)}px)` : 'none';
  });
}

async function reset(page: Page) {
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
}

test('no screen scrolls sideways at phone width', async ({ page }) => {
  await reset(page);

  // Home, with something to show.
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('A list with a fairly long name');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input')
    .fill('a task with a deliberately long name to push the layout');
  await page.waitForTimeout(250);

  // The task editor open — the densest row in the app.
  expect(await overflow(page), `list + editor: ${await widestOffender(page)}`).toBeLessThanOrEqual(1);
  await page.getByTestId('task-collapse').last().click();
  expect(await overflow(page), `list view: ${await widestOffender(page)}`).toBeLessThanOrEqual(1);

  await page.getByTestId('back').click();
  expect(await overflow(page), `home: ${await widestOffender(page)}`).toBeLessThanOrEqual(1);

  for (const [entry, label] of [
    ['settings-link', 'settings'],
    ['search-entry', 'search'],
  ] as const) {
    await page.getByTestId(entry).click();
    expect(await overflow(page), `${label}: ${await widestOffender(page)}`).toBeLessThanOrEqual(1);
    await page.getByTestId('back').click();
  }

  await page.getByTestId('big-button').click();
  expect(await overflow(page), `randomizer: ${await widestOffender(page)}`).toBeLessThanOrEqual(1);
});

test('the task editor survives the narrowest phone anyone still uses', async ({ page }) => {
  // 320px is the original SE / smallest viewport worth supporting. If the
  // densest screen holds together here it holds together everywhere.
  await page.setViewportSize({ width: 320, height: 640 });
  await reset(page);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Tiny');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('a task on a very small screen');
  await page.waitForTimeout(250);

  expect(await overflow(page), `editor at 320px: ${await widestOffender(page)}`)
    .toBeLessThanOrEqual(1);

  // And the three date/number fields still don't sit on top of each other.
  const boxes = await Promise.all(
    ['task-deadline-input', 'task-timebox-input', 'task-estimate-input'].map((id) =>
      page.getByTestId(id).boundingBox(),
    ),
  );
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      expect(
        a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height,
        `fields ${i} and ${j} overlap at 320px`,
      ).toBe(false);
    }
  }
});
