import { expect, test, type Page } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'feature flows on chromium');

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

test('list settings: shows the name, cancels cleanly, saves weekday hours', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Office');
  await page.getByTestId('back').click();
  const listId = (await page.getByTestId(/^list-row-/).first().getAttribute('data-testid'))!
    .replace('list-row-', '');

  // opens with the list's name visible, and Escape leaves no changes
  await page.getByTestId(`list-menu-${listId}`).click();
  await expect(page.getByTestId('list-settings-title')).toHaveValue('Office');
  await page.getByTestId('list-settings-title').fill('Renamed but cancelled');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('list-settings')).toHaveCount(0);
  await expect(page.getByTestId(`list-row-${listId}`)).toContainText('Office');

  // weekday-only hours save and show on the row
  await page.getByTestId(`list-menu-${listId}`).click();
  await page.getByTestId('hours-add-weekdays').click();
  await page.getByTestId('hours-rule-0-from').fill('09:00');
  await page.getByTestId('hours-rule-0-to').fill('17:00');
  await page.getByTestId('list-settings-save').click();
  await expect(page.getByTestId(`list-row-${listId}`)).toContainText('weekdays 9:00–17:00');
});

test('project deadline shows the remaining workload and marks the list', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Big Project');
  await addTask(page, 'part one');
  await addTask(page, 'part two');
  await page.getByTestId('back').click();
  const listId = (await page.getByTestId(/^list-row-/).first().getAttribute('data-testid'))!
    .replace('list-row-', '');

  await page.getByTestId(`list-menu-${listId}`).click();
  await page.getByTestId('list-settings-deadline').fill('2026-08-30');
  await expect(page.getByTestId('list-settings-readout')).toContainText('2h of work left');
  await page.getByTestId('list-settings-save').click();
  await expect(page.getByTestId(`list-row-${listId}`)).toContainText('08-30');
  // Setting a deadline earns a discovery, but celebrations stay suppressed
  // under automation — an overlay here would sit on top of the next click.
  await expect(page.getByTestId('delight-unlock')).toHaveCount(0);
});

test('sub-sort reorders within a group', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Ordering');
  await addTask(page, 'zebra');
  await addTask(page, 'apple');

  // default 'smart' keeps insertion order for equal priorities
  await expect(page.getByTestId('list-subsort')).toContainText('smart');
  await page.getByTestId('list-subsort').click();
  await expect(page.getByTestId('list-subsort')).toContainText('a–z');

  const names = await page.getByTestId(/^task-row-/).allTextContents();
  expect(names[0]).toContain('apple');
  expect(names[1]).toContain('zebra');
});

test('dragging a task onto another priority group adopts it', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Dragging');
  await addTask(page, 'promote me');

  // it starts in Medium; drag it to the Max header
  await expect(page.getByTestId('group-medium')).toBeVisible();
  const row = page.getByTestId(/^task-row-/).first();
  await page.getByText('promote me', { exact: true }).click(); // open
  await page.getByTestId('priority-max').click();              // seed a Max group to aim at
  await page.getByTestId('task-collapse').last().click();
  await addTask(page, 'drag target');

  const source = page.getByTestId(/^task-row-/).filter({ hasText: 'drag target' }).first();
  const box = (await source.boundingBox())!;
  const header = (await page.getByTestId('group-max').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(header.x + header.width / 2, header.y + header.height / 2, { steps: 12 });
  await page.mouse.up();

  // now both live under Max
  await page.getByText('drag target', { exact: true }).click();
  await expect(page.getByTestId('priority-max')).toHaveAttribute('aria-checked', 'true');
  await expect(row).toBeVisible();
});

test('multi-select bulk-completes several tasks, undoable as one', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Bulk');
  await addTask(page, 'one');
  await addTask(page, 'two');
  await addTask(page, 'three');

  const ids = await Promise.all(
    (await page.getByTestId(/^task-row-/).all()).map(async (row) =>
      (await row.getAttribute('data-testid'))!.replace('task-row-', '')),
  );
  await page.getByTestId(`select-${ids[0]}`).click();
  await page.getByTestId(`select-${ids[1]}`).click();
  await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');

  await page.getByTestId('bulk-complete').click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(1);

  await page.keyboard.press('Control+z');
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(3);
});

test('selecting a whole group and moving it to another list', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Source');
  await addTask(page, 'movable');
  await page.getByTestId('back').click();
  await makeList(page, 'Destination');
  await page.getByTestId('back').click();

  await page.getByTestId(/^list-row-/).filter({ hasText: 'Source' }).click();
  await page.getByTestId('select-group-medium').click();
  await expect(page.getByTestId('bulk-bar')).toContainText('1 selected');
  await page.getByTestId('bulk-move').selectOption({ label: 'Destination' });

  await expect(page.getByTestId(/^task-row-/)).toHaveCount(0);
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).filter({ hasText: 'Destination' }).click();
  await expect(page.getByText('movable', { exact: true })).toBeVisible();
});

test('a blocked task is skipped by the draw until its blocker is done', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Deps');
  await addTask(page, 'buy paint');
  await addTask(page, 'paint the fence');

  // "paint the fence" is Max but waits on the Medium "buy paint".
  await page.getByText('paint the fence', { exact: true }).click();
  await page.getByTestId('priority-max').click();
  // Changing priority moves the row to another group; its 220ms slide-out
  // means the old row (and its editor) is briefly still in the DOM.
  await page.waitForTimeout(300);
  await page.getByTestId('blocked-by-toggle').click();
  await page.getByTestId('blocked-by-input').fill('buy');
  await page.getByTestId(/^blocked-by-pick-/).first().click();
  await expect(page.getByTestId('blocked-by-count')).toHaveText('1');
  await page.getByTestId('task-collapse').last().click();

  // Despite being the only Max task, it never comes up — the blocker does.
  await page.getByTestId('back').click();
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('buy paint');

  // Finish the blocker; the fence is now drawable and says what it freed.
  await page.getByTestId('draw-accept').click();
  await page.getByTestId('current-complete').click();
  await expect(page.getByTestId('undo-toast')).toContainText('unblocked "paint the fence"');
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('paint the fence');
});

test('a list-scoped draw explains itself when everything there is blocked', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Waiting');
  await addTask(page, 'needs the other thing');
  await page.getByTestId('back').click();
  await makeList(page, 'Elsewhere');
  await addTask(page, 'the other thing');
  await page.getByTestId('back').click();

  await page.getByTestId(/^list-row-/).filter({ hasText: 'Waiting' }).click();
  await page.getByText('needs the other thing', { exact: true }).click();
  await page.getByTestId('blocked-by-toggle').click();
  await page.getByTestId('blocked-by-input').fill('the other thing');
  await page.getByTestId(/^blocked-by-pick-/).first().click();
  await page.getByTestId('task-collapse').last().click();

  // Rolling from THIS list can't reach the blocker, so say so rather than
  // claiming the pool is empty — the task is right there on screen.
  await page.getByTestId('list-randomize').click();
  await expect(page.getByTestId('draw-all-blocked')).toBeVisible();
});

test('the blocked-by picker refuses tasks that would make a loop', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Loops');
  await addTask(page, 'alpha');
  await addTask(page, 'beta');

  // beta waits on alpha…
  await page.getByText('beta', { exact: true }).click();
  await page.getByTestId('blocked-by-toggle').click();
  await page.getByTestId('blocked-by-input').fill('alpha');
  await page.getByTestId(/^blocked-by-pick-/).first().click();
  await page.getByTestId('task-collapse').last().click();

  // …so alpha may not wait on beta, and the picker simply doesn't offer it.
  await page.getByText('alpha', { exact: true }).click();
  await page.getByTestId('blocked-by-toggle').click();
  await page.getByTestId('blocked-by-input').fill('beta');
  await expect(page.getByTestId(/^blocked-by-pick-/)).toHaveCount(0);
});

test('timebox counts down on the current task and can be cleared', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Boxed');
  await addTask(page, 'focus work');
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await page.getByTestId('draw-accept').click();
  await expect(page.getByTestId('current-task-card')).toContainText('focus work');

  await page.getByTestId('timebox-open').click();
  await page.getByTestId('timebox-15').click();
  await expect(page.getByTestId('timebox-running')).toContainText('14:5'); // ticking down from 15:00

  await page.getByTestId('timebox-running').click(); // tap clears it
  await expect(page.getByTestId('timebox-open')).toBeVisible();
});

test('a completed task records how long it took', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Timed');
  await addTask(page, 'quick one');
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await page.getByTestId('draw-accept').click();
  await page.getByTestId('current-complete').click();
  await expect(page.getByTestId('current-task-card')).toHaveCount(0);

  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('quick one');
  await expect(page.getByTestId('search-completed')).toContainText('⧗');
});

test('lists can be dragged into a new order, and it sticks', async ({ page }) => {
  await reset(page);
  for (const name of ['Alpha', 'Beta', 'Gamma']) {
    await makeList(page, name);
    await page.getByTestId('back').click();
  }
  // Read the title element rather than the row's whole text: the row also
  // carries a grip, a count and a menu button.
  const titles = () => page.locator('[data-list-row] .list-title').allTextContents();
  expect(await titles()).toEqual(['Alpha', 'Beta', 'Gamma']);

  // Drag Gamma up above Alpha by its grip.
  const gamma = page.getByTestId(/^list-row-/).filter({ hasText: 'Gamma' }).first();
  const id = (await gamma.getAttribute('data-testid'))!.replace('list-row-', '');
  const from = (await page.getByTestId(`list-drag-${id}`).boundingBox())!;
  const target = (await page.getByTestId(/^list-row-/).first().boundingBox())!;
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(target.x + target.width / 2, target.y + 6, { steps: 12 });
  await page.mouse.up();

  await expect.poll(titles).toEqual(['Gamma', 'Alpha', 'Beta']);

  // And it survives a reload — the order is persisted, not just on screen.
  await page.reload();
  await page.getByTestId('new-list').waitFor();
  expect(await titles()).toEqual(['Gamma', 'Alpha', 'Beta']);
});

test('a long list renders a page at a time instead of all at once', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Bulk'); // lands inside the new list

  // 150 tasks written straight to storage — this is about rendering, and
  // typing them through the UI would take longer than the test is worth.
  await page.evaluate(async () => {
    const listId = location.hash.split('/')[2] ?? '';
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('organizedchaos');
      open.onsuccess = () => {
        const store = open.result.transaction('tasks', 'readwrite').objectStore('tasks');
        for (let i = 0; i < 150; i += 1) {
          store.put({
            id: `bulk${i}`, listId, name: `bulk task ${i}`, notes: '', tagIds: [],
            priority: 'medium', inProgress: false, createdAt: 0, updatedAt: 0, deleted: false,
          });
        }
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  // A hash change alone would not re-read the database — the app is already up.
  await page.goto('./#/sort/priority');
  await page.reload();

  const rows = page.getByTestId(/^task-row-/);
  await expect(page.getByTestId('rows-more')).toBeAttached();
  const first = await rows.count();
  expect(first, 'a screenful, not the whole library').toBeLessThan(150);

  // Reaching the end pulls in the next page.
  await page.getByTestId('rows-more').scrollIntoViewIfNeeded();
  await expect.poll(() => rows.count(), { timeout: 5000 }).toBeGreaterThan(first);
});

test('tagging a whole selection at once, undoably', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Batch');
  await addTask(page, 'one');
  await addTask(page, 'two');

  // A tag to apply — made on the first task, then taken back off it, so both
  // tasks start untagged and the bulk control is the only thing that tags them.
  const first = page.getByTestId(/^task-row-/).filter({ hasText: 'one' }).first();
  const firstId = (await first.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`select-${firstId}`).click(); // selectable without opening
  await page.getByTestId('bulk-clear').click();

  await page.evaluate(async () => {
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('organizedchaos');
      open.onsuccess = () => {
        const tx = open.result.transaction('tags', 'readwrite');
        tx.objectStore('tags').put({
          id: 'batch-tag', name: 'errands', colorIndex: 3,
          createdAt: 0, updatedAt: 1, deleted: false,
        });
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.reload();

  await page.getByTestId('select-group-medium').click();
  await expect(page.getByTestId('bulk-bar')).toContainText('2 selected');
  await page.getByTestId('bulk-tag').selectOption({ label: '+ errands' });

  // Both rows now carry it, and one undo takes it off both.
  await expect(page.getByTestId('undo-toast')).toContainText('Tagged 2 tasks');
  await page.goto('./#/sort/tag');
  await page.reload();
  await expect(page.getByTestId('group-batch-tag')).toBeVisible();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(2);
});

test('a daily ritual is the top pick inside its window and leaves no backlog', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Life');
  await addTask(page, 'file the accounts'); // ordinary work to compete with
  await addTask(page, 'eat lunch');

  // Make lunch a ritual for a window that is open right now.
  const row = page.getByTestId(/^task-row-/).filter({ hasText: 'eat lunch' }).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByText('eat lunch', { exact: true }).click(); // expand the row
  await page.getByTestId('task-ritual-row').click();
  await page.getByTestId('ritual-from').fill('00:00');
  await page.getByTestId('ritual-to').fill('23:59');
  await page.getByTestId('ritual-save').click();
  await expect(page.getByTestId('task-ritual-row')).toContainText('every day');
  await page.getByTestId('task-collapse').click();
  await expect(page.getByTestId(`ritual-mark-${id}`)).toBeVisible();

  // It outranks the ordinary task even though its own priority is medium.
  await page.getByTestId('back').click();
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('eat lunch');

  // Doing it takes it out of the draw and records it — without removing the
  // ritual itself, which has to be there again tomorrow.
  await page.getByTestId('draw-accept').click();
  await page.getByTestId('current-complete').click();
  // The completion is deferred for its animation — wait for it to land.
  await expect(page.getByTestId('current-task-card')).toHaveCount(0);
  await page.getByTestId('completed-link').click();
  await expect(page.getByText('eat lunch', { exact: true })).toBeVisible();
  await page.getByTestId('back').click();

  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(`task-row-${id}`), 'the ritual is still on the list').toBeVisible();
  await expect(page.getByTestId(`ritual-mark-${id}`)).toBeVisible();

  // And the randomizer offers the ordinary work now, not lunch again.
  await page.getByTestId('back').click();
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('file the accounts');
});

test('the completed screen renders history a page at a time', async ({ page }) => {
  // The library import brings YEARS of completions. Building a row for every
  // one of them froze this screen the moment it opened — the same failure mode
  // search and the sort views already had.
  await reset(page);
  await makeList(page, 'History');
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().waitFor();

  await page.evaluate(async () => {
    const listId = (document.querySelector('[data-list-row]') as HTMLElement).dataset.listRow!;
    const day = 86_400_000;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('organizedchaos');
      open.onsuccess = () => {
        const store = open.result.transaction('tasks', 'readwrite').objectStore('tasks');
        for (let i = 0; i < 150; i += 1) {
          store.put({
            id: `done${i}`, listId, name: `finished thing ${i}`, notes: '', tagIds: [],
            priority: 'medium', inProgress: false, createdAt: 0, updatedAt: 1,
            completedAt: Date.now() - Math.floor(i / 10) * day, deleted: false,
          });
        }
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.goto('./#/completed');
  await page.reload();

  const rows = page.getByTestId(/^task-row-/);
  await expect(page.getByTestId('rows-more')).toBeAttached();
  const first = await rows.count();
  expect(first, 'a screenful, not the whole logbook').toBeLessThan(150);

  await page.getByTestId('rows-more').scrollIntoViewIfNeeded();
  await expect.poll(() => rows.count(), { timeout: 5000 }).toBeGreaterThan(first);
});

test('the rituals screen shows the day at a glance and ticks off from there', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Life');
  await addTask(page, 'eat lunch');
  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByText('eat lunch', { exact: true }).click();
  await page.getByTestId('task-ritual-row').click();
  await page.getByTestId('ritual-from').fill('00:00');
  await page.getByTestId('ritual-to').fill('23:59');
  await page.getByTestId('ritual-save').click();
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  // The footer link exists only once a ritual does, and says one is due.
  const link = page.getByTestId('rituals-link');
  await expect(link).toContainText('1 due');
  await link.click();

  await expect(page.getByTestId(`ritual-row-${id}`)).toContainText('eat lunch');
  await expect(page.getByTestId(`ritual-row-${id}`)).toContainText('every day');

  // Tick it off from here: it moves to done and the record lands in history.
  await page.getByTestId(`ritual-complete-${id}`).click();
  await expect(page.getByTestId(`ritual-complete-${id}`)).toBeDisabled();
  await page.getByTestId('back').click();
  await expect(page.getByTestId('rituals-link')).not.toContainText('due');
  await page.getByTestId('completed-link').click();
  await expect(page.getByText('eat lunch', { exact: true })).toBeVisible();
});
