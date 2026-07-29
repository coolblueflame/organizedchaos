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

  // NO accommodating waits, deliberately. The chain is synchronous from
  // keystroke to mounted editor now, so typing the instant Enter lands must be
  // safe — that is the entire product guarantee this test pins. (Before the
  // fix, this exact shape failed on CI: the probe caught "first renamedsecond"
  // in the OLD editor, because the new one was still an await away.)
  await page.keyboard.type('second');
  await page.waitForTimeout(600); // only the debounced tail of the save
  await page.getByTestId('task-collapse').click();
  await expect(page.getByTestId('task-name-input')).toHaveCount(0);
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

test('a finger dragging the row scrolls the page instead of picking a task up', async ({
  page, browserName,
}) => {
  test.skip(browserName !== 'webkit', 'touch behaviour');
  // Reported 2026-07-28: trying to scroll dimmed the screen and stuck a task
  // under your thumb, because any 8px pointer move armed the drag — and that
  // is exactly what a scroll gesture looks like.
  await reset(page);
  await makeListWithTask(page, 'Scrolly', 'task one');
  for (const n of ['task two', 'task three', 'task four', 'task five']) {
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-name-input').fill(n);
    await page.waitForTimeout(200);
    await page.getByTestId('task-collapse').last().click();
  }

  const row = page.getByTestId(/^task-row-/).first();
  const box = (await row.boundingBox())!;
  const cx = box.x + box.width / 2;
  const cy = box.y + box.height / 2;

  // A finger going down on the row body, then travelling — i.e. a scroll.
  // Dispatched on the row itself so it bubbles to the drag handler; sending it
  // to the body would test nothing.
  await row.dispatchEvent('pointerdown', {
    pointerType: 'touch', clientX: cx, clientY: cy, isPrimary: true, button: 0,
  });
  await page.mouse.move(cx, cy - 120, { steps: 8 });

  // No ghost and no dimming: the gesture was left alone for the browser.
  await expect(page.locator('.ghost')).toHaveCount(0);
  await expect(page.locator('.groups.dragging')).toHaveCount(0);
  await page.mouse.up();
});

test('the grip is what picks a task up', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'touch behaviour');
  await reset(page);
  await makeListWithTask(page, 'Grippy', 'draggable one');

  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await expect(page.getByTestId(`drag-${id}`)).toBeVisible();
});

test('the date field is sized by CSS, not by native chrome', async ({ page, browserName }) => {
  test.skip(browserName !== 'webkit', 'the quirk is a Safari one');
  // iOS Safari sizes date inputs from their native chrome and ignores
  // width:100%, so the field spilled past the edge of the editor while every
  // other input behaved (reported 2026-07-28). Dropping the native appearance
  // makes it an ordinary box.
  //
  // Honest limit: THIS browser sizes date inputs correctly, so the overflow
  // itself cannot be reproduced here. What is worth pinning is that the rule
  // reaches the element at all — mis-scope it and this goes red.
  await reset(page);
  await makeListWithTask(page, 'Dates', 'when is it due');
  await page.getByText('when is it due', { exact: true }).click();

  const date = page.getByTestId('task-deadline-input');
  const styles = await date.evaluate((el) => {
    const cs = getComputedStyle(el);
    return { appearance: cs.appearance, minWidth: cs.minWidth, maxWidth: cs.maxWidth };
  });
  expect(styles.appearance, 'native chrome must be off on touch').toBe('none');
  // Bracketed from both sides: removing the chrome fixed the overflow and then
  // collapsed an EMPTY field to a stub instead, so it needs a floor as well as
  // a ceiling. Losing either bound reintroduces one of the two bugs.
  expect(parseFloat(styles.minWidth), 'needs a floor so an empty field is usable')
    .toBeGreaterThan(0);
  expect(styles.maxWidth, 'needs a ceiling so a filled field cannot spill').toBe('100%');

  // Empty, it should still be a normal-looking field next to its siblings.
  const widths = await page.evaluate(() => {
    const w = (sel: string) =>
      document.querySelector(sel)!.getBoundingClientRect().width;
    return {
      date: w('[data-testid="task-deadline-input"]'),
      estimate: w('[data-testid="task-estimate-input"]'),
      editor: document.querySelector('.editor')!.getBoundingClientRect().width,
    };
  });
  expect(widths.date, 'an empty date field should not be a stub')
    .toBeGreaterThan(widths.estimate / 2);
  expect(widths.date, 'and should not overflow its editor').toBeLessThanOrEqual(widths.editor);
});

test('new todo focuses its name field in the same gesture', async ({ page }) => {
  // The old path awaited two round-trips before opening the editor, which on
  // iOS means a dead keyboard and a second tap. Focus must land immediately;
  // the keyboard half of the claim is only provable on a real device.
  await reset(page);
  await makeListWithTask(page, 'Focus', 'existing');
  await page.getByTestId('new-task').click();
  await expect(page.getByTestId('task-name-input')).toBeFocused();
});

test('the search bar hands focus to the search field in one tap', async ({ page }) => {
  await reset(page);
  await page.getByTestId('search-entry').click();
  await expect(page.getByTestId('search-input')).toBeFocused();
  // The keyboard bridge cleans up after itself.
  await expect(page.locator('#kb-bridge')).toHaveCount(0);
});
