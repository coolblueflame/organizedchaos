import { expect, test, type Page } from '@playwright/test';

/**
 * Touch-specific behaviour, reported from a home-screen install on iPhone.
 * The webkit project runs an iPhone device profile, so `pointer: coarse`
 * matches there and desktop chromium keeps the mouse behaviour — the same
 * split the app itself branches on.
 */
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

async function makeListWithTask(page: Page, list: string, task: string) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill(list);
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill(task);
  await page.waitForTimeout(250);
  await page.getByTestId('task-collapse').last().click();
}

test('opening a named task does not grab focus on touch, but does with a mouse', async ({
  page, browserName,
}) => {
  await reset(page);
  await makeListWithTask(page, 'Phone', 'existing task');

  await page.getByText('existing task', { exact: true }).click();
  const input = page.getByTestId('task-name-input');
  await expect(input).toBeVisible();

  const focused = await input.evaluate((el) => el === document.activeElement);
  if (browserName === 'webkit') {
    // Touch: the keyboard stays down until you deliberately tap the field.
    expect(focused).toBe(false);
    await input.click();
    await expect(input).toBeFocused();
    // …and that deliberate tap selects the name, so retyping replaces it.
    const selected = await input.evaluate(
      (el: HTMLInputElement) => el.value.slice(el.selectionStart ?? 0, el.selectionEnd ?? 0),
    );
    expect(selected).toBe('existing task');
  } else {
    expect(focused).toBe(true);
  }
});

test('rapid entry still focuses the new row on touch', async ({ page }) => {
  // The exception that keeps Enter-chaining usable on a phone: a task with no
  // name yet is one the user just created and is mid-flow typing into.
  await reset(page);
  await makeListWithTask(page, 'Chain', 'first');

  await page.getByText('first', { exact: true }).click();
  await page.getByTestId('task-name-input').fill('first renamed');
  await page.getByTestId('task-name-input').press('Enter');

  await expect(page.getByTestId('task-name-input')).toBeFocused();
  await page.getByTestId('task-name-input').fill('second');
  await page.getByTestId('task-name-input').press('Escape');
  await expect(page.getByText('second', { exact: true })).toBeVisible();
});

test('a task with a description is marked at a glance', async ({ page }) => {
  await reset(page);
  await makeListWithTask(page, 'Notes', 'has detail');

  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await expect(page.getByTestId(`has-notes-${id}`)).toHaveCount(0);

  await page.getByText('has detail', { exact: true }).click();
  await page.getByTestId('task-notes-input').fill('the important context');
  await page.getByTestId('task-collapse').last().click();

  await expect(page.getByTestId(`has-notes-${id}`)).toBeVisible();
});

test('form fields are at least 16px on touch, so iOS never zooms the page', async ({
  page, browserName,
}) => {
  test.skip(browserName !== 'webkit', 'the zoom behaviour is iOS-specific');
  await reset(page);
  await makeListWithTask(page, 'Zoom', 'tap me');

  await page.getByText('tap me', { exact: true }).click();
  for (const id of ['task-name-input', 'task-notes-input', 'task-deadline-input']) {
    const size = await page.getByTestId(id).evaluate(
      (el) => parseFloat(getComputedStyle(el).fontSize),
    );
    expect(size, `${id} font-size`).toBeGreaterThanOrEqual(16);
  }
});

test('the editor fields wrap instead of overlapping on a narrow screen', async ({
  page, browserName,
}) => {
  test.skip(browserName !== 'webkit', 'phone-width layout');
  await reset(page);
  await makeListWithTask(page, 'Layout', 'check me');
  await page.getByText('check me', { exact: true }).click();

  const boxes = await Promise.all(
    ['task-deadline-input', 'task-timebox-input', 'task-estimate-input'].map((id) =>
      page.getByTestId(id).boundingBox(),
    ),
  );

  // The load-bearing assertion: at phone width these must NOT all share one
  // row. Three across is what collided on a real device, and the bounding
  // boxes alone don't catch it — this browser renders a date input far
  // narrower than iOS does, so only the wrap itself is worth asserting.
  const rows = new Set(boxes.map((b) => Math.round(b!.y)));
  expect(rows.size, 'the three fields should wrap onto multiple rows').toBeGreaterThan(1);

  // Every pair either sits on a different row or is horizontally disjoint.
  for (let i = 0; i < boxes.length; i += 1) {
    for (let j = i + 1; j < boxes.length; j += 1) {
      const a = boxes[i]!;
      const b = boxes[j]!;
      const overlapsX = a.x < b.x + b.width && b.x < a.x + a.width;
      const overlapsY = a.y < b.y + b.height && b.y < a.y + a.height;
      expect(overlapsX && overlapsY, `fields ${i} and ${j} overlap`).toBe(false);
    }
  }
});
