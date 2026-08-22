import { expect, test, type Page } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'queue flows on chromium');

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

async function makeList(page: Page, title: string) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill(title);
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').waitFor();
}

async function addTask(page: Page, name: string) {
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill(name);
  await page.waitForTimeout(250); // let any re-sort settle before collapsing
  await page.getByTestId('task-collapse').last().click();
}

/** Expand a row by name, hit its editor's queue toggle, collapse again. */
async function queueByEditor(page: Page, name: string) {
  await page.getByTestId(/^task-row-/).filter({ hasText: name }).first().click();
  await page.getByTestId('task-queue-toggle').last().click();
  await expect(page.getByTestId('task-queue-toggle').last()).toContainText('in queue');
  // .last(): a re-grouped row leaves a ~220ms ghost editor in the DOM.
  await page.getByTestId('task-collapse').last().click();
}

const queueNames = (page: Page) => page.locator('[data-queue-row] .q-name').allTextContents();

test('queued tasks pre-empt the tiers in the draw and show their provenance', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Plan');
  await addTask(page, 'shiny max thing');
  await addTask(page, 'planned first');
  await addTask(page, 'planned second');

  // Give the unqueued task MAX priority — the queue must still outrank it.
  await page.getByTestId(/^task-row-/).filter({ hasText: 'shiny max thing' }).first().click();
  await page.getByTestId('priority-max').last().click();
  await page.getByTestId('task-collapse').last().click();

  await queueByEditor(page, 'planned first');
  await queueByEditor(page, 'planned second');
  await page.getByTestId('back').click();

  // The home section lists them in queue order.
  await expect(page.getByTestId('queue-section')).toBeVisible();
  await expect.poll(() => queueNames(page)).toEqual(['planned first', 'planned second']);

  // The draw serves the queue top — deterministically, despite the max task.
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-from-queue')).toBeVisible();
  await expect(page.getByTestId('draw-card')).toContainText('planned first');
});

test('"not now" on a queued draw advances the plan permanently', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Plan');
  await addTask(page, 'first thing');
  await addTask(page, 'second thing');
  await queueByEditor(page, 'first thing');
  await queueByEditor(page, 'second thing');
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('first thing');
  await page.getByTestId('draw-not-now').click();
  // The next in line is served…
  await expect(page.getByTestId('draw-card')).toContainText('second thing');
  // …and the skipped one is OUT of the queue, not just out of this session.
  await page.getByTestId('back').click();
  await expect.poll(() => queueNames(page)).toEqual(['second thing']);
  // Leaving and re-rolling must not resurrect the skipped task at the top.
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('second thing');
});

test('the queue reorders by grip-drag and the order is data', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Plan');
  await addTask(page, 'alpha');
  await addTask(page, 'beta');
  await queueByEditor(page, 'alpha');
  await queueByEditor(page, 'beta');
  await page.getByTestId('back').click();
  await expect.poll(() => queueNames(page)).toEqual(['alpha', 'beta']);

  // Synthetic pointer events, same rationale as the custom-sort drag: real
  // mouse frames starve on CI runners while the flip reflow is mid-flight.
  const row = page.locator('[data-queue-row]').filter({ hasText: 'beta' });
  const id = (await row.getAttribute('data-queue-row'))!;
  await page.evaluate((taskId) => {
    const grip = document.querySelector(`[data-testid="queue-drag-${taskId}"]`)!;
    const g = grip.getBoundingClientRect();
    const first = document.querySelector('[data-queue-row]')!.getBoundingClientRect();
    const fire = (type: string, target: EventTarget, x: number, y: number) =>
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse',
      }));
    fire('pointerdown', grip, g.x + 4, g.y + 4);
    fire('pointermove', window, g.x + 4, g.y - 20);
    fire('pointermove', window, first.x + 40, first.y + 2);
    fire('pointermove', window, first.x + 40, first.y + 3);
    fire('pointerup', window, first.x + 40, first.y + 3);
  }, id);

  await expect.poll(() => queueNames(page)).toEqual(['beta', 'alpha']);
  await page.reload();
  await expect.poll(() => queueNames(page), { timeout: 4000 }).toEqual(['beta', 'alpha']);
});

test('check-off drains the queue; clear is two-tap and undoable', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Plan');
  await addTask(page, 'one');
  await addTask(page, 'two');
  await queueByEditor(page, 'one');
  await queueByEditor(page, 'two');
  await page.getByTestId('back').click();

  // Completing from the queue removes the row (completion, not un-queueing).
  const oneRow = page.locator('[data-queue-row]').filter({ hasText: 'one' });
  const oneId = (await oneRow.getAttribute('data-queue-row'))!;
  await page.getByTestId(`queue-check-${oneId}`).click();
  await expect.poll(() => queueNames(page)).toEqual(['two']);

  // The ✕ un-queues without completing — the task is still in its list.
  const twoRow = page.locator('[data-queue-row]').filter({ hasText: 'two' });
  const twoId = (await twoRow.getAttribute('data-queue-row'))!;
  await page.getByTestId(`queue-remove-${twoId}`).click();
  await expect(page.getByTestId('queue-section')).toHaveCount(0);
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(/^task-row-/).filter({ hasText: 'two' })).toHaveCount(1);
  await page.getByTestId('back').click();

  // Clear: first tap arms, second clears, Cmd+Z brings the plan back.
  await page.getByTestId(/^list-row-/).first().click();
  await queueByEditor(page, 'two');
  await page.getByTestId('back').click();
  await expect(page.getByTestId('queue-section')).toBeVisible();
  await page.getByTestId('queue-clear').click();
  await expect(page.getByTestId('queue-clear')).toContainText('tap again');
  await page.getByTestId('queue-clear').click();
  await expect(page.getByTestId('queue-section')).toHaveCount(0);
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId('queue-section')).toBeVisible();
  await expect.poll(() => queueNames(page)).toEqual(['two']);
});

test('tapping a queued task opens THAT task, expanded', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Plans');
  await addTask(page, 'the one I queued');
  await queueByEditor(page, 'the one I queued');
  await page.getByTestId('back').click();

  // Pre-fix this landed on the list with nothing open — you then had to go
  // find the row you were just looking at (2026-08-19 report).
  await page.locator('[data-queue-row] .q-main').first().click();
  await expect(page.getByTestId('task-name-input')).toHaveValue('the one I queued');
});

test('a completed ritual leaves the day queue', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Daily');
  await addTask(page, 'drink water');
  await page.getByTestId(/^task-row-/).filter({ hasText: 'drink water' }).first().click();
  await page.getByTestId('task-ritual-row').click();
  await page.getByTestId('ritual-from').fill('00:00');
  await page.getByTestId('ritual-to').fill('23:59');
  await page.getByTestId('ritual-save').click();
  await page.getByTestId('task-queue-toggle').last().click();
  await page.getByTestId('task-collapse').last().click();
  await page.getByTestId('back').click();

  const qRow = page.locator('[data-queue-row]').first();
  const id = (await qRow.getAttribute('data-queue-row'))!;
  await page.getByTestId(`queue-check-${id}`).click();
  // A ritual's row stays open (rituals stamp the day, they don't close), so
  // the queue held it forever (2026-08-19 report). Done for the day = the
  // plan is served; the row leaves the queue but survives in its list.
  await expect(page.getByTestId(`queue-row-${id}`)).toHaveCount(0);
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByText('drink water', { exact: true })).toBeVisible();
});

test('ticking a queued task celebrates like every other checkbox', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Party');
  await addTask(page, 'the queued one');
  await queueByEditor(page, 'the queued one');
  await page.getByTestId('back').click();

  // The queue's checkbox finished in silence while list rows and the
  // current-task card both threw confetti (2026-08-22 report). Bursts are
  // drawn to a shared canvas, so the count is the only honest witness.
  const bursts = () => page.evaluate(
    () => (window as unknown as { __ocBurstsEmitted?: () => number }).__ocBurstsEmitted?.() ?? 0);
  // Wait for the row to EXIST before reading it: count()/getAttribute() don't
  // auto-wait, and home renders its queue a beat after the mirror loads.
  const row = page.locator('[data-queue-row]').first();
  await row.waitFor();
  const before = await bursts();
  const id = (await row.getAttribute('data-queue-row'))!;
  await page.getByTestId(`queue-check-${id}`).click();
  await expect.poll(bursts, { message: 'the queue throws confetti too' })
    .toBeGreaterThan(before);

  // …and the completion itself still lands, animation gate and all.
  await expect(page.getByTestId(`queue-row-${id}`)).toHaveCount(0);
  await page.getByTestId('completed-link').click();
  await expect(page.getByText('the queued one', { exact: true })).toBeVisible();
});
