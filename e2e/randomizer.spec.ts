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

async function seed(page: import('@playwright/test').Page, names: string[]) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Pool');
  await page.getByTestId('new-list-input').press('Enter');
  for (const name of names) {
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-name-input').fill(name);
    await page.getByTestId('task-collapse').click();
  }
  await page.getByTestId('back').click();
}

/** Set a single all-week hours window on a list via its settings sheet. */
async function setHours(
  page: import('@playwright/test').Page,
  listId: string,
  from: string,
  to: string,
  opts: { urgent?: boolean } = {},
) {
  await page.getByTestId(`list-menu-${listId}`).click();
  await page.getByTestId('hours-add').click();
  await page.getByTestId('hours-rule-0-from').fill(from);
  await page.getByTestId('hours-rule-0-to').fill(to);
  if (opts.urgent) await page.getByTestId('list-settings-urgent').check();
  await page.getByTestId('list-settings-save').click();
  await expect(page.getByTestId('list-settings')).toHaveCount(0);
}

test('draw → accept → current task card survives reload → complete', async ({ page }) => {
  await seed(page, ['alpha']);
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('alpha');
  await page.getByTestId('draw-accept').click();
  await expect(page.getByTestId('current-task-card')).toContainText('alpha');
  await page.reload(); // current task survives an app kill
  await expect(page.getByTestId('current-task-card')).toContainText('alpha');
  await page.getByTestId('current-complete').click();
  await expect(page.getByTestId('current-task-card')).toHaveCount(0);
  await page.getByTestId('completed-link').click();
  // exact: the undo toast also contains the task name
  await expect(page.getByText('alpha', { exact: true })).toBeVisible();
});

test('completing the current task invites the next roll, closing the loop', async ({ page }) => {
  const names = ['first up', 'the encore'];
  await seed(page, names);
  await page.getByTestId('big-button').click();
  // The draw is random — remember which of the two it picked. Wait out the
  // scramble reveal before reading, or the text matches neither name.
  await expect(page.getByTestId('draw-card')).toContainText(/first up|the encore/);
  const drawn = (await page.getByTestId('draw-card').textContent())!;
  const first = names.find((n) => drawn.includes(n))!;
  const other = names.find((n) => n !== first)!;
  await page.getByTestId('draw-accept').click();
  await expect(page.getByTestId('current-task-card')).toContainText(first);
  await page.getByTestId('current-complete').click();

  // The card doesn't dead-end into idle — it offers the next roll, and the
  // roll commits DIRECTLY into the current-task slot (2026-08-01 ask): no
  // accept screen, the big button is right below for browsing.
  const invite = page.getByTestId('current-roll-next');
  await expect(invite).toContainText('that’s 1 today');
  await page.getByTestId('roll-next').click();
  await expect(page.getByTestId('current-task-card')).toContainText(other);
  await expect(page.getByTestId('current-roll-next')).toHaveCount(0);

  // Session-local by design: a fresh load greets instead of pushing.
  await page.getByTestId('current-not-today').click();
  await expect(page.getByTestId('current-roll-next')).toBeVisible();
  await page.reload();
  await expect(page.getByTestId('current-task-idle')).toBeVisible();
});

test('"all off" plus one chip rolls from a single list', async ({ page }) => {
  await seed(page, ['general noise']);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Work');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('only the work thing');
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await page.getByTestId('draw-filters-toggle').click();
  // Two taps to "just this list": everything off, then the one back on.
  await page.getByTestId('draw-filter-lists-none').click();
  await page.getByTestId(/^draw-filter-list-/).filter({ hasText: 'Work' }).click();
  await expect(page.getByTestId('draw-card')).toContainText('only the work thing');
  // And not by luck: repeated re-rolls never leave the list.
  for (let i = 0; i < 3; i += 1) {
    await page.getByTestId('draw-not-now').click();
    const empty = await page.getByTestId('draw-empty').count();
    if (empty) { await page.getByTestId('draw-reset-skips').click(); }
    await expect(page.getByTestId('draw-card')).toContainText('only the work thing');
  }
});

test('the escalation badge can appear while the card sits on screen', async ({ page }) => {
  // The ▲ mark derived its date once per draw, so a deadline crossing its
  // escalation threshold while the screen sat idle went unnoticed — two
  // lines below a comment warning about exactly that freeze (2026-08-18
  // second pass). The tier label already used the live clock; the two
  // halves of one line must agree.
  await seed(page, ['the deadline creeps']);
  await page.getByTestId(/^list-row-/).first().click();
  await page.getByText('the deadline creeps', { exact: true }).click();
  const tenDaysOut = new Date(Date.now() + 10 * 86_400_000);
  await page.getByTestId('task-deadline-input')
    .fill(tenDaysOut.toISOString().slice(0, 10));
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('the deadline creeps');
  await expect(page.getByTestId('draw-card')).not.toContainText('deadline-escalated');

  // The deadline arrives while the card is still up.
  await page.clock.setFixedTime(new Date(tenDaysOut.setHours(12, 0, 0, 0)));
  await page.evaluate(() => (window as unknown as { __ocTickClock?: () => void }).__ocTickClock?.());
  await expect(page.getByTestId('draw-card')).toContainText('deadline-escalated');
});

test('skipping a draw closes the inline editor before the next card', async ({ page }) => {
  // "Tweak it" left open + "not now" used to hand the NEXT card an already
  // open editor (2026-08-18 second pass): the tweak was aimed at the task
  // being skipped, not whatever the dice serve up next.
  await seed(page, ['first', 'second']);
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toBeVisible();

  await page.getByTestId('draw-edit-toggle').click();
  await expect(page.getByTestId('task-notes-input')).toBeVisible();

  await page.getByTestId('draw-not-now').click();
  await expect(page.getByTestId('draw-card')).toContainText('tweak it');
  await expect(page.getByTestId('task-notes-input')).toHaveCount(0);
});

test('not now cycles to a different task; exhausting pool offers skip reset', async ({ page }) => {
  await seed(page, ['one', 'two']);
  await page.getByTestId('big-button').click();
  const first = await page.getByTestId('draw-card').textContent();
  await page.getByTestId('draw-not-now').click();
  const second = await page.getByTestId('draw-card').textContent();
  expect(second).not.toBe(first); // guaranteed different task
  await page.getByTestId('draw-not-now').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible();
  await page.getByTestId('draw-reset-skips').click();
  await expect(page.getByTestId('draw-card')).toBeVisible();
});

test('not today truly snoozes: pool empties with no reset offer, task stays in list', async ({ page }) => {
  await seed(page, ['snoozeme']);
  await page.getByTestId('big-button').click();
  await page.getByTestId('draw-not-today').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible();
  await expect(page.getByTestId('draw-reset-skips')).toHaveCount(0); // real snooze, not a skip
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  // exact: the undo toast also contains the task name
  await expect(page.getByText('snoozeme', { exact: true })).toBeVisible(); // unaffected outside the randomizer
});

test('in-progress task is preferred by the draw', async ({ page }) => {
  await seed(page, ['started', 'fresh']);
  await page.getByTestId(/^list-row-/).first().click();
  await page.getByText('started', { exact: true }).click();
  await page.getByTestId('task-make-current').click(); // lands on home with card
  await expect(page.getByTestId('current-task-card')).toContainText('started');
  await page.getByTestId('current-clear').click(); // no longer current, still inProgress

  // In-progress is weighted 5:1, not guaranteed (the exact odds are unit-tested),
  // so assert it surfaces across a handful of rolls rather than on any single one.
  let sawStarted = false;
  for (let i = 0; i < 6 && !sawStarted; i++) {
    await page.getByTestId('big-button').click();
    try {
      // expect() retries, which also rides out the slot-machine name reveal —
      // reading textContent directly would catch scrambled characters.
      await expect(page.getByTestId('draw-card')).toContainText('started', { timeout: 2000 });
      sawStarted = true;
    } catch {
      // this roll landed on the other task
    }
    await page.getByTestId('back').click();
  }
  expect(sawStarted).toBe(true);
});

test('omitting a list chip excludes it from the global draw', async ({ page }) => {
  await seed(page, ['inpool']);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Other');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('outsider');
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  // knock the "Pool" list out of the draw — chips start all-selected, and the
  // whole panel starts closed so a big library doesn't bury the roll
  await expect(page.getByTestId(/^draw-filter-list-/)).toHaveCount(0);
  await page.getByTestId('draw-filters-toggle').click();
  await page.getByTestId(/^draw-filter-list-/).filter({ hasText: 'Pool' }).click();
  await expect(page.getByTestId('draw-card')).toContainText('outsider');
  await page.getByTestId('draw-not-now').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible(); // inpool never surfaces
});

test('scheduled hours keep an off-clock list out of the draw, with an override', async ({ page }) => {
  // Sit at 22:00 local so a 09:00–17:00 list is asleep.
  await page.clock.setFixedTime(new Date(new Date().setHours(22, 0, 0, 0)));
  // Poke the app's shared clock to re-read the now-mocked date (the module
  // booted on real time; visibility/reload nudges proved engine-dependent).
  await page.evaluate(() => (window as unknown as { __ocTickClock?: () => void }).__ocTickClock?.());

  await seed(page, ['daytime task']);

  // Give "Pool" working hours via its settings sheet
  const listRow = page.getByTestId(/^list-row-/).first();
  const listId = (await listRow.getAttribute('data-testid'))!.replace('list-row-', '');
  await setHours(page, listId, '09:00', '17:00');
  // Symbol-only rows (2026-08-01): the window text lives in the tooltip.
  await expect(listRow.locator('.window')).toHaveAttribute('title', /9:00–17:00/);

  // At 22:00 the global draw skips it, but offers to roll anyway
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible();
  await page.getByTestId('draw-ignore-hours').click();
  await expect(page.getByTestId('draw-card')).toContainText('daytime task');
});

test('urgent override lets MAX-priority through while the list is off the clock', async ({ page }) => {
  await page.clock.setFixedTime(new Date(new Date().setHours(22, 0, 0, 0)));
  // Poke the app's shared clock to re-read the now-mocked date (the module
  // booted on real time; visibility/reload nudges proved engine-dependent).
  await page.evaluate(() => (window as unknown as { __ocTickClock?: () => void }).__ocTickClock?.());

  await seed(page, ['routine thing']);

  // add an urgent one alongside it
  await page.getByTestId(/^list-row-/).first().click();
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('the server is on fire');
  await page.getByTestId('priority-max').click();
  // Bumping priority re-sorts the list, remounting the row — let the outro
  // finish so the old node's button isn't still in the DOM.
  await page.waitForTimeout(300);
  await page.getByTestId('task-collapse').last().click();
  await page.getByTestId('back').click();

  // office hours + "urgent still gets through"
  const listRow = page.getByTestId(/^list-row-/).first();
  const listId = (await listRow.getAttribute('data-testid'))!.replace('list-row-', '');
  await setHours(page, listId, '09:00', '17:00', { urgent: true });

  // At 22:00 the routine task is asleep, but the fire still gets drawn —
  // repeatedly, because it's the only eligible task in the pool.
  for (let i = 0; i < 3; i++) {
    await page.getByTestId('big-button').click();
    await expect(page.getByTestId('draw-card')).toContainText('the server is on fire');
    await page.getByTestId('back').click();
  }
});

test('a list is drawable inside its scheduled hours', async ({ page }) => {
  await page.clock.setFixedTime(new Date(new Date().setHours(11, 0, 0, 0)));
  // Poke the app's shared clock to re-read the now-mocked date (the module
  // booted on real time; visibility/reload nudges proved engine-dependent).
  await page.evaluate(() => (window as unknown as { __ocTickClock?: () => void }).__ocTickClock?.());
  // This test needs the mock to actually take mid-page, which webkit does not
  // reliably honour — verify, and bow out honestly rather than fail on an
  // engine limitation (chromium, which CI gates, always exercises this).
  const mockedHour = await page.evaluate(() => new Date().getHours());
  test.skip(mockedHour !== 11, 'clock mock not effective mid-page on this engine');

  await seed(page, ['daytime task']);
  const listRow = page.getByTestId(/^list-row-/).first();
  const listId = (await listRow.getAttribute('data-testid'))!.replace('list-row-', '');
  await setHours(page, listId, '09:00', '17:00');

  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('daytime task');
});

test('list-scoped randomizer only draws from that list', async ({ page }) => {
  await seed(page, ['inpool']);
  // second list with a task that must never be drawn
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Other');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('outsider');
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId(/^list-row-/).first().click(); // "Pool"
  await page.getByTestId('list-randomize').click();
  await expect(page.getByTestId('draw-card')).toContainText('inpool');
  await page.getByTestId('draw-not-now').click();
  await expect(page.getByTestId('draw-empty')).toBeVisible(); // outsider never appears
});

test('the filter panel stays out of the way but never hides that it is on', async ({ page }) => {
  await seed(page, ['a task']);
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Drop');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('another task');
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  const toggle = page.getByTestId('draw-filters-toggle');
  await expect(toggle, 'closed by default, and honest about it').toContainText('everything in');

  await toggle.click();
  await page.getByTestId(/^draw-filter-list-/).filter({ hasText: 'Drop' }).click();
  await expect(toggle, 'a filter left on has to be visible from the summary').toContainText('1 list off');

  // Searching narrows the chips rather than making you scroll past a hundred.
  await page.getByTestId('draw-search-lists').fill('poo');
  await expect(page.getByTestId(/^draw-filter-list-/)).toHaveCount(1);

  await page.getByTestId('draw-filter-lists-all').click();
  await expect(toggle).toContainText('everything in');
});
