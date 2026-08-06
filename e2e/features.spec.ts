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

test("the current-task card jumps straight to the task's details", async ({ page }) => {
  await reset(page);
  await makeList(page, 'Trips');
  await addTask(page, 'pack for the lake');
  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-row-${id}`).click();
  await page.getByTestId('task-make-current').last().click();
  await expect(page.getByTestId('current-task-card')).toBeVisible();

  // Tap the name on the card → land in the list WITH the editor open,
  // ready for the actual use case: adding checklist items.
  await page.getByTestId('current-open-details').click();
  await expect(page.getByTestId('task-name-input')).toHaveValue('pack for the lake');
  await page.getByTestId('task-add-checklist').click();
  await page.keyboard.type('sunscreen');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // end the chain
  await expect(page.getByTestId('task-notes-input')).toHaveValue('- [ ] sunscreen');

  // …and the card now shows the fresh item, tickable from home.
  await page.getByTestId('back').click();
  await page.getByTestId(`check-item-${id}-0`).click();
  await expect(page.getByTestId('current-check-progress')).toContainText('1/1');
});

test('a checklist lives inside a task: button-built, tappable, counted', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Trips');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('pack for the lake');

  // The button opens an inline item input; Enter chains the next one, and
  // an abandoned empty item cleans itself up (rapid-entry, checklist-sized).
  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId('task-add-checklist').click();
  await page.keyboard.type('socks');
  await page.keyboard.press('Enter');
  await page.keyboard.type('charger');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Escape'); // end the chain — the empty third item vanishes
  await expect(page.getByTestId('task-notes-input')).toHaveValue('- [ ] socks\n- [ ] charger');

  // Tapping the TEXT renames in place; renaming to nothing deletes.
  await page.getByTestId(`check-text-${id}-0`).click();
  await expect(page.getByTestId(`check-edit-${id}-0`)).toHaveValue('socks');
  await page.getByTestId(`check-edit-${id}-0`).fill('wool socks');
  await page.keyboard.press('Enter');
  await expect(page.getByTestId('task-notes-input')).toHaveValue('- [ ] wool socks\n- [ ] charger');

  // Ticking rewrites the text itself.
  await page.getByTestId(`check-item-${id}-0`).click();
  await expect(page.getByTestId('task-notes-input')).toHaveValue('- [x] wool socks\n- [ ] charger');
  await page.waitForTimeout(250);
  await page.getByTestId('task-collapse').last().click();

  // The row wears a live count instead of the plain notes marker.
  await expect(page.getByTestId(`check-count-${id}`)).toContainText('1/2');

  // As the CURRENT task, the checklist is workable straight from the card.
  await page.getByTestId(`task-row-${id}`).click();
  await page.getByTestId('task-make-current').last().click();
  await expect(page.getByTestId('current-task-card')).toBeVisible();
  await page.getByTestId(`check-item-${id}-1`).click();
  await expect(page.getByTestId('current-check-progress')).toContainText('2/2');
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(`check-count-${id}`)).toContainText('2/2');

  // Unticking from the editor round-trips the same text.
  await page.getByTestId(`task-row-${id}`).click();
  await page.getByTestId(`check-item-${id}-0`).last().click();
  await expect(page.getByTestId('task-notes-input')).toHaveValue('- [ ] wool socks\n- [x] charger');
});

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
  // Rows show a symbol only now (2026-08-01) — the window text lives in its tooltip.
  await expect(page.getByTestId(`list-row-${listId}`).locator('.window'))
    .toHaveAttribute('title', /weekdays 9:00–17:00/);
});

test('project deadline shows the remaining workload and marks the list', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Big Project');
  await addTask(page, 'part one');
  await addTask(page, 'part two');
  await page.getByTestId('back').click();
  const listId = (await page.getByTestId(/^list-row-/).first().getAttribute('data-testid'))!
    .replace('list-row-', '');

  // The list's own workload line, same 1h-default math as the stats hero.
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId('list-work-left')).toContainText('2h of work left');
  await page.getByTestId('back').click();

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

test('a task added from the button lands at the TOP of the screen, not the bottom', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Long');
  // Enough rows that the page genuinely scrolls, so "where did it land" is a
  // real question rather than an artifact of a short list.
  for (let i = 0; i < 14; i += 1) await addTask(page, `filler ${i}`);

  const before = await page.evaluate(() => window.scrollY);
  await page.getByTestId('new-task').click();

  // The TITLE is what you type into, so the TITLE is what must sit at the
  // top — on screen (y >= 0) and near it. The first version of this test
  // asserted only y < 150, which a title scrolled OFF the top (negative y)
  // also satisfies: that one-sided bound is exactly how the bug it was
  // written for survived it (2026-08-06 report).
  const title = page.getByTestId('task-name-input');
  await expect(title).toBeVisible();
  await expect.poll(async () => {
    const box = await title.boundingBox();
    if (!box) return 'no box';
    return box.y >= 0 && box.y < 150 ? 'at the top' : `y=${Math.round(box.y)}`;
  }, { message: 'the new task title sits at the top of the viewport' }).toBe('at the top');
  expect(await page.evaluate(() => window.scrollY)).toBeGreaterThan(before);

  /*
    And the jump is ONE-SHOT. The reset used to live in a function nothing
    called, so 'start' stuck for the rest of the visit and every later tap
    jump-scrolled the tapped row to the top (caught by review with a live
    probe: mid-screen row, y=406 → title at y=4). A tap must scroll only
    the minimum.
  */
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-name-input')).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  const midRow = page.getByText('filler 4', { exact: true });
  const rowYBefore = (await midRow.boundingBox())!.y;
  expect(rowYBefore).toBeGreaterThan(150); // genuinely mid-screen before the tap
  await midRow.click();
  await expect(page.getByTestId('task-name-input')).toBeVisible();
  // Deliberately NOT a poll: proving "it does not move" needs the scroll to
  // have already happened (or not). A poll-until-true samples BEFORE the
  // requestAnimationFrame scroll and passes on the pre-scroll position —
  // which is exactly how the first version of this assertion passed with the
  // fix removed. Under automation motion is off, so the scroll is instant;
  // 400ms is generous settle time.
  await page.waitForTimeout(400);
  const settled = (await page.getByTestId('task-name-input').boundingBox())!;
  expect(Math.round(settled.y), 'a tapped row is not yanked to the top').toBeGreaterThan(60);
});

test('the list-header dice is actually visible, not black-on-black', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Seen');
  /*
    Regression guard for a whole CLASS of bug: a chrome-less button
    (background:none) never inherits text color — the UA default is black,
    and on this app's near-black background the stroked glyph disappears.
    The scoped-draw e2e kept passing the whole time, because invisible is
    not unclickable: this one asserts CONTRAST, which is what eyes need.
  */
  const contrast = await page.evaluate(() => {
    const lum = (css: string) => {
      const [r, g, b] = css.match(/\d+/g)!.map(Number).map((v) => {
        const c = v / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
    };
    const el = document.querySelector('[data-testid="list-randomize"]')!;
    const fg = lum(getComputedStyle(el).color);
    const bg = lum(getComputedStyle(document.body).backgroundColor);
    return (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
  });
  expect(contrast).toBeGreaterThan(3); // black-on-near-black measures ~1.1
});

/** Insert open tasks straight into Dexie's store — 70 UI adds cost ~30s. */
async function seedTasksDirect(page: Page, listId: string, rows: Array<{ id: string; name: string; priority: string }>) {
  await page.evaluate(({ listId, rows }) => new Promise<void>((resolve, reject) => {
    const req = indexedDB.open('organizedchaos');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      const tx = req.result.transaction('tasks', 'readwrite');
      const store = tx.objectStore('tasks');
      const now = Date.now();
      for (const r of rows) {
        store.put({
          id: r.id, listId, name: r.name, notes: '', tagIds: [], priority: r.priority,
          inProgress: false, createdAt: now, updatedAt: now, deleted: false,
        });
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    };
  }), { listId, rows });
  await page.reload(); // direct IndexedDB fixtures need a reload to be seen
  await page.getByTestId('new-list').waitFor();
}

test('a deep link reaches a task buried past the render budget', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Deep');
  await page.getByTestId('back').click();
  const listId = (await page.getByTestId(/^list-row-/).first().getAttribute('data-testid'))!
    .replace('list-row-', '');

  /*
    70 medium fillers, and the target at SOMEDAY priority so its group renders
    after all of them — index ≥ 70, past the 60-row budget. Before the budget
    learned to grow toward the open editor, the deep link "expanded" a task
    with no DOM: the card sat offscreen-unmounted until manual scrolling paged
    it in (2026-08-06 report, via the fill-in card's jump).
  */
  // Comfortably past the 60-row budget (and a second page of it, for margin):
  // an instrumented probe confirmed the budget holds at exactly 60 here
  // without the growth effect — the target simply does not exist in the DOM.
  await seedTasksDirect(page, listId, [
    ...Array.from({ length: 140 }, (_, i) => ({ id: `filler-${i}`, name: `filler ${i}`, priority: 'medium' })),
    { id: 'buried-target', name: 'the buried one', priority: 'someday' },
  ]);

  await page.goto(`./#/list/${listId}/task/buried-target`);
  const title = page.getByTestId('task-name-input');
  await expect(title).toBeVisible();
  await expect(title).toHaveValue('the buried one');
  await expect.poll(async () => {
    const box = await title.boundingBox();
    if (!box) return 'no box';
    return box.y >= 0 && box.y < 150 ? 'at the top' : `y=${Math.round(box.y)}`;
  }, { message: 'the jump lands with the title at the top, no scrolling needed' }).toBe('at the top');
});

test('removing a tag in tag view keeps the relocated card on screen', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Sorted');
  await page.getByTestId('back').click();
  const listId = (await page.getByTestId(/^list-row-/).first().getAttribute('data-testid'))!
    .replace('list-row-', '');

  /*
    140 untagged fillers: past the fold and comfortably past the render
    budget, so the relocated card only exists if the budget grows toward it. The tagged task sits at the top of tag view; removing
    its tag drops it to the BOTTOM of untagged — which used to strand the
    view where the card had been (2026-08-06 report). Now the budget grows to
    keep the open editor mounted and the remounted editor reveals itself.
  */
  await seedTasksDirect(page, listId, Array.from({ length: 140 }, (_, i) =>
    ({ id: `plain-${i}`, name: `plain ${i}`, priority: 'medium' })));
  await page.getByTestId(/^list-row-/).first().click();
  await addTask(page, 'the tagged one');
  await page.getByText('the tagged one', { exact: true }).click();
  await page.getByTestId('new-tag').click();
  await page.getByTestId('new-tag-input').fill('zzlast');
  await page.getByTestId('new-tag-input').press('Enter');
  await page.getByTestId('new-tag-done').click();
  await page.getByTestId('task-collapse').last().click();
  await page.getByTestId('back').click();

  await page.getByTestId('sort-tag').click();
  await page.getByText('the tagged one', { exact: true }).click();
  await expect(page.getByTestId('task-name-input')).toHaveValue('the tagged one');

  // Remove the tag from the open editor: the row relocates to untagged.
  await page.getByTestId(/^tag-chip-/).filter({ hasText: 'zzlast' }).click();

  // The editor is still mounted, still open, and ON SCREEN — not stranded.
  const title = page.getByTestId('task-name-input');
  await expect(title).toHaveValue('the tagged one');
  await page.waitForTimeout(500); // let the reveal + intros settle
  const box = (await title.boundingBox())!;
  const viewH = page.viewportSize()!.height;
  expect(box.y, 'the relocated card is inside the viewport').toBeGreaterThanOrEqual(0);
  expect(box.y, 'the relocated card is inside the viewport').toBeLessThan(viewH - 40);
});

test('moving the open task to another list follows it there', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Origin');
  await page.getByTestId('back').click();
  await makeList(page, 'Destination');
  await page.getByTestId('back').click();

  await page.getByTestId(/^list-row-/).filter({ hasText: 'Origin' }).click();
  await addTask(page, 'the traveller');
  // Re-open it and move it via the editor's list select.
  await page.getByText('the traveller', { exact: true }).click();
  await page.getByTestId('task-move-list').last().selectOption({ label: 'Destination' });

  // The card used to be swooped away, editor and all (2026-08-06 report).
  // Now the screen follows: Destination's deep link, editor open, title on top.
  await expect(page).toHaveURL(/#\/list\/.+\/task\/.+$/);
  await expect(page.getByTestId('task-name-input')).toHaveValue('the traveller');
  await expect(page.getByTestId('list-title')).toContainText('Destination');
});

test('selecting notes text with the mouse does not lift the card', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Deskwork');
  await addTask(page, 'write the report');
  await addTask(page, 'file the report');

  // Expand one and put some text in its notes.
  await page.getByText('write the report', { exact: true }).click();
  await page.getByTestId('task-notes-input').fill('a long description worth selecting');

  /*
    A mouse-drag ACROSS THE NOTES FIELD — the select-some-text gesture
    (2026-08-06 report: it lifted the whole card). Synthetic mouse-type
    PointerEvents, same as every drag spec here: a real mouse ride starves on
    CI runners, and the handlers under test are pointer-event listeners.
  */
  const notes = page.getByTestId('task-notes-input');
  const nb = (await notes.boundingBox())!;
  // Down + move only — the pointer is still "held" when the assertion runs.
  // (First draft dispatched pointerup in the same breath, and the drop clears
  // the ghost either way: the assertion passed with the guard REMOVED, i.e.
  // it proved nothing. The ghost only exists between move and up.)
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)!;
    const base = { pointerId: 1, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: x, clientY: y }));
    window.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: x + 80, clientY: y }));
  }, { x: nb.x + 10, y: nb.y + 10 });

  await expect(page.locator('.ghost'), 'no drag ghost while selecting text').toHaveCount(0);
  await expect(page.getByTestId('task-notes-input'), 'the editor survives').toBeVisible();
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1, pointerType: 'mouse', bubbles: true }));
  });

  // TEETH the other way: the same gesture on a COLLAPSED row's body still
  // starts the desktop drag-to-regroup — the guard must not over-exclude.
  // Collapse first: the open editor pushes the second row below the fold, and
  // elementFromPoint cannot see past the viewport's edge.
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('task-notes-input')).toHaveCount(0);
  const other = page.getByTestId(/^task-row-/).filter({ hasText: 'file the report' }).first();
  const ob = (await other.boundingBox())!;
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y)!;
    const base = { pointerId: 2, pointerType: 'mouse', button: 0, bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: x, clientY: y }));
    window.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: x, clientY: y + 60 }));
  }, { x: ob.x + ob.width / 2, y: ob.y + ob.height / 2 });
  await expect(page.locator('.ghost'), 'body-drag on a collapsed row still lifts').toHaveCount(1);
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointerup', { pointerId: 2, pointerType: 'mouse', bubbles: true }));
  });
});

test('cancelling a boxed task silences its alarm', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Boxed');
  await addTask(page, 'abandoned work');
  await page.getByTestId('back').click();
  await page.getByTestId('big-button').click();
  await page.getByTestId('draw-accept').click();

  await page.evaluate(() => {
    (window as unknown as { __alarms: number }).__alarms = 0;
    const w = window as unknown as { Notification: unknown };
    w.Notification = class {
      static permission = 'granted';
      constructor() { (window as unknown as { __alarms: number }).__alarms += 1; }
    };
  });

  await page.getByTestId('timebox-open').click();
  await page.getByTestId('timebox-5').click();
  // Put the task down — the ✕ on the card (2026-08-06 report: the alarm
  // still fired later, for a task nobody was doing).
  await page.getByTestId('current-clear').click();
  await expect(page.getByTestId('current-task-card')).toHaveCount(0);

  await page.clock.install();
  await page.clock.fastForward('06:00');
  await page.waitForTimeout(1500); // several watcher sweeps' worth
  expect(await page.evaluate(() => (window as unknown as { __alarms: number }).__alarms),
    'no alarm for a cancelled box').toBe(0);
});

test('a timebox alarm fires from another screen, not just the home card', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Boxed');
  await addTask(page, 'focus work');
  await page.getByTestId('back').click();
  await page.getByTestId('big-button').click();
  await page.getByTestId('draw-accept').click();

  // Count the alarms the app raises, whichever screen is showing.
  await page.evaluate(() => {
    (window as unknown as { __alarms: number }).__alarms = 0;
    const w = window as unknown as { Notification: unknown };
    w.Notification = class {
      static permission = 'granted';
      constructor() { (window as unknown as { __alarms: number }).__alarms += 1; }
    };
  });

  await page.getByTestId('timebox-open').click();
  await page.getByTestId('timebox-5').click();

  // Walk AWAY from the card that draws the countdown — this is the reported
  // bug: the timer used to unmount with it and the alarm never came.
  await page.getByTestId('stats-strip').click();
  await expect(page.getByTestId('stats-estimate')).toBeVisible();

  // Jump past the deadline. The watcher sweeps every second.
  await page.clock.install();
  await page.clock.fastForward('06:00');
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __alarms: number }).__alarms))
    .toBeGreaterThan(0);
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

test('the estimate field lets you finish typing "45m" without rewriting it', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Est');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('paint the fence');

  // Regression: every keystroke used to parse, save, and re-render the field
  // from what was saved — so the "m" turned the text into "0.75" mid-word,
  // and typing "45min" left "0.75in" behind.
  const est = page.getByTestId('task-estimate-input');
  await est.click();
  await est.pressSequentially('45min', { delay: 40 });
  await expect(est, 'the field keeps what was typed').toHaveValue('45min');

  // Blurring tidies it into the canonical short form of the SAME value.
  await page.getByTestId('task-notes-input').click();
  await expect(est).toHaveValue('45m');

  // And the stored value is right: 45 minutes of work on this list.
  await page.waitForTimeout(250);
  await page.getByTestId('task-collapse').last().click();
  await expect(page.getByTestId('list-work-left')).toContainText('45m');
});

test('"already did this one" completes the draw without inventing a duration', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Chores');
  await addTask(page, 'took out the bins');
  await page.getByTestId('back').click();

  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('took out the bins');
  await page.getByTestId('draw-already-did').click();

  // It never became the current task, so no clock was ever started.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('current-task-card')).toHaveCount(0);

  // It IS completed — and carries no tracked time. Going through accept
  // would have written a couple of seconds that never happened, and that
  // number feeds the estimate-vs-reality comparisons.
  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('bins');
  const done = page.getByTestId('search-completed');
  await expect(done).toContainText('took out the bins');
  await expect(done, 'no invented duration').not.toContainText('⧗');
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
  // Poll, don't read: allTextContents() takes whatever is there RIGHT NOW, and
  // right now is mid-navigation — under a loaded machine Home hasn't mounted
  // its rows yet and the read comes back empty. This was the whole flake; the
  // drag below was never the problem.
  await expect.poll(titles).toEqual(['Alpha', 'Beta', 'Gamma']);

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
  await expect.poll(titles).toEqual(['Gamma', 'Alpha', 'Beta']);
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

test('a ritual can hold several daily windows, once-a-day or each-time', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Health');
  await addTask(page, 'drink water');

  await page.getByText('drink water', { exact: true }).click();
  await page.getByTestId('task-ritual-row').click();
  await page.getByTestId('ritual-from').fill('09:00');
  await page.getByTestId('ritual-to').fill('09:30');

  // A second window appears with its own inputs; the contract checkbox with it.
  await page.getByTestId('ritual-add-window').click();
  await page.getByTestId('ritual-from-1').fill('14:00');
  await page.getByTestId('ritual-to-1').fill('14:30');
  await expect(page.getByTestId('ritual-each-row')).toContainText('any one window');
  await page.getByTestId('ritual-each').check();
  await expect(page.getByTestId('ritual-each-row')).toContainText('every window');
  await page.getByTestId('ritual-save').click();

  // The summary names both windows and the contract, and survives reopening.
  await expect(page.getByTestId('task-ritual-row'))
    .toContainText('every day 09:00–09:30 + 14:00–14:30 · each time');
  await page.getByTestId('task-ritual-row').click();
  await expect(page.getByTestId('ritual-from')).toHaveValue('09:00');
  await expect(page.getByTestId('ritual-from-1')).toHaveValue('14:00');
  await expect(page.getByTestId('ritual-each')).toBeChecked();

  // Dropping the second window falls back to a plain single-window ritual.
  await page.getByTestId('ritual-window-drop-1').click();
  await page.getByTestId('ritual-save').click();
  await expect(page.getByTestId('task-ritual-row'))
    .toContainText('every day 09:00–09:30');
});

test('a daily ritual is the top pick inside its window and leaves no backlog', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Life');
  await addTask(page, 'file the accounts'); // ordinary work to compete with
  await addTask(page, 'eat lunch');

  // The competitor gets MAX priority — a due ritual must beat even that
  // (2026-07-29: rituals outrank everything while their window is open).
  await page.getByTestId(/^task-row-/).filter({ hasText: 'file the accounts' }).first().click();
  await page.getByTestId('priority-max').last().click();
  await page.getByTestId('task-collapse').last().click();

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
  // Pin mid-afternoon FIRST (the wall-clock rule): the "all-day" window
  // below is 00:00–23:59, and windows are to-EXCLUSIVE — for the final
  // minute of every real day the ritual is not due, and CI collected that
  // sixty-second bet at 23:59:50Z. The poke re-reads the mocked clock.
  await page.clock.setFixedTime(new Date(new Date().setHours(14, 0, 0, 0)));
  await page.evaluate(() => (window as unknown as { __ocTickClock?: () => void }).__ocTickClock?.());
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

test('archiving a list shelves it everywhere the app proposes work', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Cruft');
  await addTask(page, 'stale thing');
  await page.getByTestId('back').click();
  await makeList(page, 'Current');
  await addTask(page, 'real work');
  await page.getByTestId('back').click();

  // Archive Cruft from its settings sheet.
  const cruft = page.getByTestId(/^list-row-/).filter({ hasText: 'Cruft' }).first();
  const id = (await cruft.getAttribute('data-testid'))!.replace('list-row-', '');
  await page.getByTestId(`list-menu-${id}`).click();
  await page.getByTestId('list-settings-archive').click();

  // Off the home groups, onto the shelf.
  await expect(page.getByTestId(`list-row-${id}`)).toHaveCount(0);
  await page.getByTestId('archived-shelf').click();
  await expect(page.getByTestId(`archived-row-${id}`)).toContainText('Cruft');

  // The dice never propose it: only the real work draws.
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('real work');
  await page.getByTestId('draw-not-now').click();
  await expect(page.getByTestId('draw-empty'), 'nothing else in the pool').toBeVisible();
  await page.getByTestId('back').click();

  // Out of the global sort views too — but search still finds it.
  await page.getByTestId('sort-priority').click();
  await expect(page.getByText('stale thing', { exact: true })).toHaveCount(0);
  await page.getByTestId('back').click();
  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('stale');
  await expect(page.getByText('stale thing', { exact: true })).toBeVisible();
  await page.getByTestId('back').click();

  // Revive: back on home, back in the pool.
  await page.getByTestId('archived-shelf').click();
  await page.getByTestId(`unarchive-${id}`).click();
  await expect(page.getByTestId(`list-row-${id}`)).toBeVisible();
});

test('dragging to a screen edge scrolls the page, faster the closer you get', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Long');
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().waitFor();
  // A page tall enough to need scrolling, seeded directly.
  await page.evaluate(async () => {
    const listId = (document.querySelector('[data-list-row]') as HTMLElement).dataset.listRow!;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('organizedchaos');
      open.onsuccess = () => {
        const store = open.result.transaction('tasks', 'readwrite').objectStore('tasks');
        for (let i = 0; i < 40; i += 1) {
          store.put({
            id: `d${i}`, listId, name: `drag target ${i}`, notes: '', tagIds: [],
            priority: 'medium', inProgress: false, createdAt: 0, updatedAt: 1, deleted: false,
          });
        }
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.goto('./#/sort/priority');
  await page.reload();
  await page.getByTestId(/^task-row-/).first().waitFor();

  const grip = page.getByTestId(/^drag-/).first();
  const box = (await grip.boundingBox())!;
  const h = await page.evaluate(() => window.innerHeight);
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();

  // Shallow in the band: a creep.
  await page.mouse.move(box.x + 40, h - 80, { steps: 6 });
  const y0 = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(400);
  const shallow = (await page.evaluate(() => window.scrollY)) - y0;
  expect(shallow, 'parked in the band must scroll').toBeGreaterThan(0);

  // Hard against the edge: a sprint — measurably faster than the creep.
  await page.mouse.move(box.x + 40, h - 6, { steps: 4 });
  const y1 = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(400);
  const deep = (await page.evaluate(() => window.scrollY)) - y1;
  expect(deep, 'the ramp: edge beats band').toBeGreaterThan(shallow * 1.5);

  // Releasing stops it dead.
  await page.mouse.up();
  const y2 = await page.evaluate(() => window.scrollY);
  await page.waitForTimeout(300);
  expect(await page.evaluate(() => window.scrollY), 'no scrolling after release').toBe(y2);
});

test('a done-for-the-day ritual can still be edited and moved from the rituals screen', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Life');
  await addTask(page, 'eat lunch');
  await page.getByText('eat lunch', { exact: true }).click();
  await page.getByTestId('task-ritual-row').click();
  await page.getByTestId('ritual-from').fill('00:00');
  await page.getByTestId('ritual-to').fill('23:59');
  await page.getByTestId('ritual-save').click();
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();
  await makeList(page, 'Wind-down');
  await page.getByTestId('back').click();

  await page.getByTestId('rituals-link').click();
  const row = page.getByTestId(/^ritual-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('ritual-row-', '');

  // Done for the day — the reported state where editing was unreachable.
  await page.getByTestId(`ritual-complete-${id}`).click();
  await expect(page.getByTestId(`ritual-complete-${id}`)).toBeDisabled();

  // Tapping the ritual now opens its editor in place…
  await page.getByTestId(`ritual-edit-${id}`).click();
  await expect(page.getByTestId('ritual-editor-sheet')).toContainText('eat lunch');
  // …with the full move control.
  await page.getByTestId('ritual-editor-sheet').getByTestId('task-move-list')
    .selectOption({ label: 'Wind-down' });
  await page.getByTestId('ritual-editor-close').click();

  // Moved, still a ritual, still done today.
  await expect(page.getByTestId(`ritual-row-${id}`)).toContainText('every day');
  await page.getByTestId(`ritual-list-${id}`).click();
  await expect(page.getByText('eat lunch', { exact: true })).toBeVisible();
});

test('every screen opens at its top, not at the last screen\'s scroll', async ({ page }) => {
  // Reported: the completed screen always opened ~a page down — the browser
  // keeps scroll across in-place route swaps, and the footer links live a page
  // down on home. Seed enough history to make the completed screen tall.
  await reset(page);
  await makeList(page, 'History');
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().waitFor();
  await page.evaluate(async () => {
    const listId = (document.querySelector('[data-list-row]') as HTMLElement).dataset.listRow!;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('organizedchaos');
      open.onsuccess = () => {
        const store = open.result.transaction('tasks', 'readwrite').objectStore('tasks');
        for (let i = 0; i < 80; i += 1) {
          store.put({
            id: `h${i}`, listId, name: `done ${i}`, notes: '', tagIds: [], priority: 'medium',
            inProgress: false, createdAt: 0, updatedAt: 1, completedAt: Date.now() - i * 60_000,
            deleted: false,
          });
        }
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.reload();

  // Scroll deep into completed, leave, come back: top again, newest visible.
  await page.getByTestId('completed-link').click();
  await page.getByTestId(/^task-row-/).first().waitFor();
  await page.evaluate(() => window.scrollTo(0, 1200));
  await page.getByTestId('back').click();
  await page.getByTestId('completed-link').click();
  await expect.poll(() => page.evaluate(() => window.scrollY)).toBe(0);
  await expect(page.getByText('done 0', { exact: true })).toBeInViewport();
});

test('finished work can be read, re-filed into a goals list, and counted there', async ({ page }) => {
  // The year-end flow: move completed wins into a goals list, then read the
  // count off that list's collapsed history shelf.
  await reset(page);
  await makeList(page, 'Inbox');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('learn the accordion');
  await page.getByTestId('task-notes-input').fill('two songs by December');
  await page.getByTestId('task-collapse').click();
  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
  await page.getByTestId('back').click();
  await makeList(page, '2026 Goals');
  await page.getByTestId('back').click();

  // Completed screen: the row opens, shows its description, and moves.
  await page.getByTestId('completed-link').click();
  await page.getByText('learn the accordion', { exact: true }).click();
  await expect(page.getByTestId(`done-detail-${id}`)).toContainText('two songs by December');
  await page.getByTestId(`done-move-${id}`).selectOption({ label: '2026 Goals' });
  await page.getByTestId('back').click();

  // The goals list now carries it on its history shelf, count first.
  await page.getByTestId(/^list-row-/).filter({ hasText: '2026 Goals' }).first().click();
  const shelf = page.getByTestId('list-completed');
  await expect(shelf, 'done/lifetime fraction').toContainText('completed here · 1/1');
  await shelf.locator('summary').click();
  await expect(page.getByText('learn the accordion', { exact: true })).toBeVisible();
});

test('a scroll that starts on another task does not collapse the open editor', async ({ page }) => {
  // Reported: expand the bottom task, instinctively drag up on a row above to
  // see the rest of the editor — and the touch was read as a tap, collapsing
  // it. A drag must scroll; only a true tap switches.
  await reset(page);
  await makeList(page, 'Slop');
  await addTask(page, 'first');
  await addTask(page, 'second');

  await page.getByText('second', { exact: true }).click();
  await expect(page.getByTestId('task-name-input')).toBeFocused();

  /*
    A FINGER drag on the other row, dispatched as touch-type pointer events.
    That is faithful to the report, and it matters: a body drag only starts a
    regroup for a MOUSE (see GroupedTasks' pointerType guard), so driving this
    with page.mouse tested the desktop regroup path instead — and left its drag
    ghost in the DOM, which then made the "first" lookup below ambiguous on a
    slow enough machine. Touch exercises the protection that actually shields
    the reported gesture.
  */
  const other = page.getByTestId(/^task-row-/).filter({ hasText: 'first' }).first();
  const box = (await other.boundingBox())!;
  await page.evaluate(({ x, y }) => {
    const el = document.elementFromPoint(x, y);
    if (!el) throw new Error('nothing under the drag start point');
    const base = { pointerId: 1, pointerType: 'touch', bubbles: true, cancelable: true };
    el.dispatchEvent(new PointerEvent('pointerdown', { ...base, clientX: x, clientY: y }));
    el.dispatchEvent(new PointerEvent('pointermove', { ...base, clientX: x, clientY: y + 60 }));
    el.dispatchEvent(new PointerEvent('pointerup', { ...base, clientX: x, clientY: y + 60 }));
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
  await expect(page.getByTestId('task-name-input'), 'the editor survives a scroll').toHaveCount(1);

  // A clean tap on the other row still switches to it. (Assert by VALUE — an
  // expanded row holds its name in an input, which getByText cannot see.)
  await page.getByText('first', { exact: true }).click();
  await expect(page.getByTestId('task-name-input')).toHaveValue('first');
});

test('expanding a task near the bottom scrolls its editor into view', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Tall');
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().waitFor();
  await page.evaluate(async () => {
    const listId = (document.querySelector('[data-list-row]') as HTMLElement).dataset.listRow!;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('organizedchaos');
      open.onsuccess = () => {
        const store = open.result.transaction('tasks', 'readwrite').objectStore('tasks');
        for (let i = 0; i < 25; i += 1) {
          store.put({
            id: `t${i}`, listId, name: `filler ${i}`, notes: '', tagIds: [], priority: 'medium',
            inProgress: false, createdAt: i, updatedAt: 1, deleted: false,
          });
        }
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  });
  await page.goto(`./#/list/${await page.evaluate(() =>
    (document.querySelector('[data-list-row]') as HTMLElement).dataset.listRow)}`);
  await page.reload();

  // Open the LAST visible row near the bottom of the viewport.
  const last = page.getByTestId(/^task-row-/).last();
  await last.scrollIntoViewIfNeeded();
  await page.getByText('filler 24', { exact: true }).click();

  // The whole editor ends up on screen (smooth scroll: poll until it settles).
  await expect.poll(async () => {
    const box = await page.getByTestId('task-collapse').boundingBox();
    const h = await page.evaluate(() => window.innerHeight);
    return box !== null && box.y + box.height <= h;
  }, { timeout: 4000 }).toBe(true);
});

test('finishing tracked work with an estimate splashes the comparison', async ({ page }) => {
  await page.clock.install();
  await reset(page);
  await makeList(page, 'Timed');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('write the report');
  await page.getByTestId('task-estimate-input').fill('1');
  await page.waitForTimeout(250);
  await page.getByTestId('task-collapse').last().click();

  // Work on it for a tracked half hour, then finish.
  await page.getByText('write the report', { exact: true }).click();
  await page.getByTestId('task-make-current').click();
  await page.clock.fastForward('30:00');
  await page.getByTestId('current-complete').click();

  // The splash teaches: actual vs estimate, at the moment of completion.
  await expect(page.getByTestId('undo-toast')).toContainText('30m under the estimate');

  // And the completed view remembers the lesson.
  await page.getByTestId('completed-link').click();
  await page.getByText('write the report', { exact: true }).click();
  const row = page.getByTestId(/^task-row-/).filter({ hasText: 'write the report' }).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await expect(page.getByTestId(`done-estimate-${id}`))
    .toContainText('estimated 1h · took 30m — 30m under the estimate');
});

test('custom sort: starts oldest-first, drags into a hand-built order, and sticks', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Arranged');
  for (const name of ['first added', 'second added', 'third added']) {
    await addTask(page, name);
  }

  // Cycle sort to custom: priority → date → tag → custom.
  for (let i = 0; i < 3; i += 1) await page.getByTestId('list-sort').click();
  await expect(page.getByTestId('list-sort')).toContainText('custom');

  const titles = () => page.locator('[data-drag-row] .name').allTextContents();
  await expect.poll(titles, { timeout: 4000 })
    .toEqual(['first added', 'second added', 'third added']); // creation order

  // Drag the last row to the top by its grip — driven with synthetic pointer
  // events dispatched in-page. Playwright's real mouse rides the OS/driver
  // scheduler, which on a loaded CI box can starve the frames the live reflow
  // hit-test reads; dispatching directly makes the sequence deterministic and
  // still exercises every app handler (grip pointerdown, window move/up).
  const third = page.getByTestId(/^task-row-/).filter({ hasText: 'third added' }).first();
  const id = (await third.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.evaluate((taskId) => {
    const grip = document.querySelector(`[data-testid="drag-${taskId}"]`)!;
    const g = grip.getBoundingClientRect();
    const first = document.querySelector('[data-drag-row]')!.getBoundingClientRect();
    const fire = (type: string, target: EventTarget, x: number, y: number) =>
      target.dispatchEvent(new PointerEvent(type, {
        bubbles: true, clientX: x, clientY: y, button: 0, pointerId: 1, pointerType: 'mouse',
      }));
    fire('pointerdown', grip, g.x + 4, g.y + 4);
    fire('pointermove', window, g.x + 4, g.y - 20);        // past the threshold: drag engages
    fire('pointermove', window, first.x + 40, first.y + 2); // above the first row's midpoint
    fire('pointermove', window, first.x + 40, first.y + 3); // re-test after the reflow
    fire('pointerup', window, first.x + 40, first.y + 3);
  }, id);

  await expect.poll(titles).toEqual(['third added', 'first added', 'second added']);

  // Survives a reload — the order is data, not screen state.
  await page.reload();
  await expect.poll(titles, { timeout: 4000 })
    .toEqual(['third added', 'first added', 'second added']);

  // A task added after arranging joins at the bottom, disturbing nothing.
  await addTask(page, 'newcomer');
  await expect.poll(titles)
    .toEqual(['third added', 'first added', 'second added', 'newcomer']);
});

test('the floating + adds a todo without leaving your scroll position', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Fab');
  await page.getByTestId('list-fab').click();
  await expect(page.getByTestId('task-name-input')).toBeFocused();
  await page.keyboard.type('added from the corner');
  await page.getByTestId('task-collapse').click();
  await expect(page.getByText('added from the corner', { exact: true })).toBeVisible();
});

test('a task in progress wears its marker in the list', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Marks');
  await addTask(page, 'being worked');
  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await expect(page.getByTestId(`inprogress-mark-${id}`)).toHaveCount(0);
  await page.getByText('being worked', { exact: true }).click();
  await page.getByTestId('task-make-current').click(); // lands on home, in progress
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(`inprogress-mark-${id}`)).toBeVisible();
});

test('"now" filters the priority screen to what is actually available', async ({ page }) => {
  await reset(page);
  // Fix the clock BEFORE building anything: the shared ticking clock captures
  // its first value at boot, and a reload later would race the just-saved
  // hours write (mirror-first put still in flight when the page dies).
  await page.clock.setFixedTime(new Date(new Date().setHours(14, 0, 0, 0)));
  await page.evaluate(() => (window as unknown as { __ocTickClock?: () => void }).__ocTickClock?.());
  await makeList(page, 'Anytime');
  await addTask(page, 'doable now');
  await page.getByTestId('back').click();
  await makeList(page, 'NightOnly');
  await addTask(page, 'after hours only');
  await page.getByTestId('back').click();
  // Put NightOnly far off the clock: a one-minute window at 03:00.
  const night = page.getByTestId(/^list-row-/).filter({ hasText: 'NightOnly' }).first();
  const nid = (await night.getAttribute('data-testid'))!.replace('list-row-', '');
  await page.getByTestId(`list-menu-${nid}`).click();
  await page.getByTestId('hours-add').click();
  await page.getByTestId('hours-rule-0-from').fill('03:00');
  await page.getByTestId('hours-rule-0-to').fill('03:01');
  await page.getByTestId('list-settings-save').click();

  await page.getByTestId('sort-priority').click();
  await expect(page.getByText('after hours only', { exact: true })).toBeVisible();
  await page.getByTestId('sort-available-now').click();
  await expect(page.getByText('after hours only', { exact: true })).toHaveCount(0);
  await expect(page.getByText('doable now', { exact: true })).toBeVisible();

  // Sticky: still on after leaving and returning.
  await page.getByTestId('back').click();
  await page.getByTestId('sort-priority').click();
  await expect(page.getByTestId('sort-available-now')).toContainText('● now');
});

test('settings: sections read in the agreed order and the alarm secret is write-only', async ({ page }) => {
  await page.goto('./');
  await page.getByTestId('settings-link').click();
  await expect(page.locator('main h2').first()).toHaveText('this device');

  const heads = await page.locator('main h2').allTextContents();
  const idx = (t: string) => heads.indexOf(t);
  expect(idx('what the symbols mean')).toBe(idx('sync') - 1);
  expect(idx('locked lists')).toBe(idx('sync') + 1);
  expect(heads[heads.length - 1]).toBe('backup & data');

  // The alarm pane only exists where push does — guard, then bite.
  if (await page.getByTestId('settings-alarms').isVisible()) {
    expect(idx('timebox alarms')).toBe(idx('morning reminders') + 1);

    // Write-only: saving a secret must leave the input EMPTY — the stored
    // value may never ride back into the DOM where devtools could read it.
    const secret = page.getByTestId('alarm-secret');
    await secret.fill('a-very-secret-bearer-token');
    await secret.blur();
    await expect(secret).toHaveValue('');
    await expect(secret).toHaveAttribute('placeholder', /saved ✓/);

    // Survives reload as "saved", still without surfacing the value.
    await page.reload();
    const after = page.getByTestId('alarm-secret');
    await expect(after).toHaveAttribute('placeholder', /saved ✓/);
    await expect(after).toHaveValue('');

    // And it can be forgotten.
    await page.getByTestId('alarm-secret-clear').click();
    await expect(after).toHaveAttribute('placeholder', /ALARM_SECRET/);
  }
});

test('redo brings back what undo took, until a fresh action forks history', async ({ page }) => {
  await reset(page);
  await makeList(page, 'Redoable');
  await addTask(page, 'flip me');
  await addTask(page, 'bystander');

  const flip = page.getByTestId(/^task-row-/).filter({ hasText: 'flip me' }).first();
  const flipId = (await flip.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${flipId}`).click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(1);

  // Take it back…
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(2);

  // …then change your mind again…
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(1);

  // …and the redo re-armed the undo: one more Cmd+Z restores it once more.
  await page.keyboard.press('Control+z');
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(2);

  // A fresh action forks history: complete the OTHER task, after which redo
  // must NOT resurrect the undone completion of the first.
  const by = page.getByTestId(/^task-row-/).filter({ hasText: 'bystander' }).first();
  const byId = (await by.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${byId}`).click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(1);

  await page.keyboard.press('Control+Shift+z');
  // Settle-then-assert (a poll passes before a wrong redo lands): a redo that
  // wrongly fired would complete "flip me" too and drop the count to 0.
  await page.waitForTimeout(350);
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(1);
  await expect(page.getByText('flip me', { exact: true })).toBeVisible();
});

test('a ritual already done today still completes again from the current card', async ({ page }) => {
  await reset(page);
  // Pinned mid-afternoon — the all-day window below is to-exclusive, and the
  // last minute of a real day once cost CI a sixty-second bet (see the
  // day-at-a-glance test). The poke re-reads the mocked clock.
  await page.clock.setFixedTime(new Date(new Date().setHours(14, 0, 0, 0)));
  await page.evaluate(() => (window as unknown as { __ocTickClock?: () => void }).__ocTickClock?.());
  await makeList(page, 'Life');
  await addTask(page, 'walk the dog');
  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByText('walk the dog', { exact: true }).click();
  await page.getByTestId('task-ritual-row').click();
  await page.getByTestId('ritual-from').fill('00:00');
  await page.getByTestId('ritual-to').fill('23:59');
  await page.getByTestId('ritual-save').click();
  await page.getByTestId('task-collapse').click();

  // Done for the day, the ordinary way. The row stays — rituals never leave.
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toBeVisible();

  // Life happens twice: re-accept the done ritual as the current task…
  await page.getByText('walk the dog', { exact: true }).click();
  await page.getByTestId('task-make-current').click();
  await expect(page.getByTestId('current-task-card')).toContainText('walk the dog');

  // …and completing it must actually complete — this stranded the card
  // (confetti, no effect) when the already-credited day was an early return.
  await page.getByTestId('current-complete').click();
  await expect(page.getByTestId('current-task-card')).toHaveCount(0);

  // Both efforts are history: two completed records, one credited day.
  await page.getByTestId('completed-link').click();
  await expect(page.getByText('walk the dog', { exact: true })).toHaveCount(2);
});
