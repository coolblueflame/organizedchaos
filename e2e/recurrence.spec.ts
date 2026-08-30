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

test('after-completion task respawns after the interval (clock time-travel)', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Rec');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('water plants');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill('3');
  await page.getByTestId('recur-save').click();
  await page.getByTestId('task-collapse').click();

  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(0);

  // Four days later, reopening the app resurrects it via the init sweep.
  await page.clock.install({ time: Date.now() + 4 * 86_400_000 });
  await page.reload();
  await page.getByTestId('new-task').waitFor();
  await expect(page.getByTestId(/^task-row-/).first()).toContainText('water plants');
});

test('recurring screen lists, pauses, and deletes templates', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Rec');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('weekly thing');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-weekly').click();
  await page.getByTestId('recur-weekday-1').click();
  await page.getByTestId('recur-save').click();
  await page.getByTestId('back').click();

  await page.getByTestId('recurring-link').click();
  const row = page.getByTestId(/^recurring-row-/).first();
  await expect(row).toContainText('weekly thing');
  await expect(row).toContainText('every Mon');
  const id = (await row.getAttribute('data-testid'))!.replace('recurring-row-', '');

  // Tapping the row opens the cadence editor, same as the pencil does.
  await page.getByTestId(`recurring-open-${id}`).click();
  await expect(page.getByTestId('recur-save')).toBeVisible();
  await page.getByTestId(`recurring-open-${id}`).click(); // and closes it again
  await expect(page.getByTestId('recur-save')).toHaveCount(0);
  await page.getByTestId(`recurring-edit-${id}`).click();
  await expect(page.getByTestId('recur-save'), 'the pencil still works too').toBeVisible();
  await page.getByTestId(`recurring-edit-${id}`).click();

  await page.getByTestId(`recurring-pause-${id}`).click();
  await expect(row).toContainText('paused');
  page.on('dialog', (d) => void d.accept());
  await page.getByTestId(`recurring-delete-${id}`).click();
  await expect(page.getByTestId(`recurring-row-${id}`)).toHaveCount(0);
});

test('recurring rows surface the live copy, re-home it, and turn up in search', async ({ page }) => {
  // Two lists; the recurring task starts in Rec.
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Garden');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('back').click();
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Rec');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('water the ferns');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill('3');
  await page.getByTestId('recur-save').click();
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('recurring-link').click();
  const row = page.getByTestId(/^recurring-row-/).first();
  const tplId = (await row.getAttribute('data-testid'))!.replace('recurring-row-', '');

  // The live copy is named, and the jump lands in its list.
  await expect(page.getByTestId(`recurring-jump-${tplId}`)).toContainText('open copy in Rec');
  await page.getByTestId(`recurring-jump-${tplId}`).click();
  await expect(page.getByTestId(/^task-row-/).filter({ hasText: 'water the ferns' })).toHaveCount(1);
  await page.getByTestId('back').click();

  // Re-homing the rule moves the open copy with it.
  await page.getByTestId('recurring-link').click();
  const garden = await page.getByTestId(`recurring-move-${tplId}`)
    .locator('option', { hasText: 'Garden' }).getAttribute('value');
  await page.getByTestId(`recurring-move-${tplId}`).selectOption(garden!);
  await expect(page.getByTestId(`recurring-jump-${tplId}`)).toContainText('open copy in Garden');
  await page.getByTestId(`recurring-jump-${tplId}`).click();
  await expect(page.getByTestId(/^task-row-/).filter({ hasText: 'water the ferns' })).toHaveCount(1);
  await page.getByTestId('back').click();

  // The RULE is findable by search, between live and done.
  await page.getByTestId('search-entry').click();
  await page.getByTestId('search-input').fill('ferns');
  await expect(page.getByTestId('search-recurring')).toContainText('water the ferns');
  await page.getByTestId(`search-tpl-${tplId}`).click();
  await expect(page.getByTestId(`recurring-row-${tplId}`)).toBeVisible();
  // …and it lands ON that rule with its editor already open, rather than
  // dumping you at the top of the screen to find it again (2026-08-05 ask).
  await expect(page.getByTestId(`recurring-open-${tplId}`)).toHaveAttribute('aria-expanded', 'true');
  await expect(page).toHaveURL(new RegExp(`#/recurring/${tplId}$`));
});

test('editor shows the cadence summary on a recurring task', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Rec');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('rent');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-monthly').click();
  await page.getByTestId('recur-monthday').fill('1');
  await page.getByTestId('recur-deadline-offset').fill('5');
  await page.getByTestId('recur-save').click();
  await expect(page.getByTestId('task-recur-row')).toContainText('monthly on the 1st · deadline +5d');

  // 0 is not "unset": it means due the day the task appears, and must survive save.
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-deadline-offset').fill('0');
  await page.getByTestId('recur-save').click();
  await expect(page.getByTestId('task-recur-row')).toContainText('monthly on the 1st · due same day');
});

test('every-2-weeks and multi-day monthly round-trip through the editor', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Cadence');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('deep clean');
  await page.getByTestId('task-recur-row').click();

  // Every second Monday.
  await page.getByTestId('recur-mode-weekly').click();
  await page.getByTestId('recur-weekday-1').click();
  await page.getByTestId('recur-every-weeks').selectOption('2');
  await page.getByTestId('recur-save').click();
  await expect(page.getByTestId('task-recur-row')).toContainText('every 2 weeks on Mon');

  // Reopening keeps the choice — the select survives the round trip.
  await page.getByTestId('task-recur-row').click();
  await expect(page.getByTestId('recur-every-weeks')).toHaveValue('2');

  // Switch to monthly: the 15th AND the true last day.
  await page.getByTestId('recur-mode-monthly').click();
  await page.getByTestId('recur-monthday').fill('15');
  await page.getByTestId('recur-last-day').click();
  await page.getByTestId('recur-save').click();
  await expect(page.getByTestId('task-recur-row')).toContainText('monthly on the 15th and last day');

  // Round-trip again, drop the 15th via its chip: only "last day" remains.
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-monthday-drop-15').click();
  await page.getByTestId('recur-save').click();
  await expect(page.getByTestId('task-recur-row')).toContainText('monthly on the last day');
});

test('editing a recurring task shows the rule drift, and one tap adopts it', async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Lake');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('go for a walk');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill('1');
  await page.getByTestId('recur-save').click();

  // In step with its rule: no drift line.
  await expect(page.getByTestId('rule-drift')).toHaveCount(0);

  // Bump the instance to MAX — the exact 2026-08-11 surprise: the rule
  // still says medium, and tomorrow's spawn would be born medium.
  await page.getByTestId('priority-max').click();
  await expect(page.getByTestId('rule-drift')).toContainText('medium');
  await expect(page.getByTestId('rule-drift')).toContainText('future spawns follow it');

  // One explicit tap makes the rule match — drift gone, and it STAYS gone
  // across a collapse/expand (the rule really changed, not just the line).
  await page.getByTestId('rule-adopt').click();
  await expect(page.getByTestId('rule-drift')).toHaveCount(0);
  await page.getByTestId('task-collapse').click();
  await page.getByText('go for a walk', { exact: true }).click();
  await expect(page.getByTestId('rule-drift')).toHaveCount(0);
});

test("deleting a recurring copy offers to stop the rule — and doesn't whack-a-mole", async ({ page }) => {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Lake');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('stretch');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-afterCompletion').click();
  await page.getByTestId('recur-interval').fill('1');
  await page.getByTestId('recur-save').click();

  // Delete the copy: the toast carries the second, rule-ending choice.
  const row = page.getByTestId(/^task-row-/).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-delete-${id}`).click(); // arm…
  await page.getByTestId(`task-delete-${id}`).click(); // …confirm
  await expect(page.getByTestId('toast-extra')).toHaveText('stop repeating too');

  // Reloading (the sweep runs at init) must NOT resurrect it today —
  // the 2026-08-11 whack-a-mole.
  await page.reload();
  await page.getByTestId('new-task').waitFor();
  await expect(page.getByText('stretch', { exact: true })).toHaveCount(0);

  // A plain (non-recurring) delete never shows the offer.
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('one-off');
  const row2 = page.getByTestId(/^task-row-/).first();
  const id2 = (await row2.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-delete-${id2}`).click();
  await page.getByTestId(`task-delete-${id2}`).click();
  await expect(page.getByTestId('undo-toast')).toBeVisible();
  await expect(page.getByTestId('toast-extra')).toHaveCount(0);
});

test('an untouched reopen-save keeps a fortnight rule on ITS weeks', async ({ page }) => {
  // Pinned: Wed Aug 12 2026 — anchor week Aug 9–15 is ON, its Monday is
  // already past, so the first spawn is Mon Aug 24 (Aug 17 sits in the
  // off week).
  await page.clock.install({ time: new Date('2026-08-12T10:00:00') });
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Cycles');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('fortnight chore');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-weekly').click();
  await page.getByTestId('recur-weekday-1').click();
  await page.getByTestId('recur-every-weeks').selectOption('2');
  await page.getByTestId('recur-save').click();
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();

  await page.getByTestId('recurring-link').click();
  const row = page.getByTestId(/^recurring-row-/).first();
  await expect(row).toContainText('every 2 weeks on Mon');
  await expect(row).toContainText('next: 8/24');
  const id = (await row.getAttribute('data-testid'))!.replace('recurring-row-', '');

  // Six days on — Tue Aug 18, the OFF week. Reopen the editor and save
  // without changing a thing: the phase must hold. (The review-caught bug
  // re-anchored on every save, flipping the on-weeks — this exact flow
  // showed "next: 8/31" and every later spawn a week off.)
  await page.clock.setFixedTime(new Date('2026-08-18T10:00:00'));
  await page.getByTestId(`recurring-edit-${id}`).click();
  await page.getByTestId('recur-save').click();
  // "Still 8/24" is a NEGATIVE (the save must not change it) — settle past
  // the async re-arm before asserting, or the read lands on the stale row.
  await expect(page.getByTestId('recur-save')).toHaveCount(0); // editor closed = save done
  await page.waitForTimeout(300);
  await expect(row).toContainText('next: 8/24');
});

test('a peppered task respawns instantly and the dice announce it', async ({ page }) => {
  // 2026-08-20 ask: chance-mode recurrence. Base 100% makes the lottery
  // deterministic for the test; real use is the whole point of lower numbers.
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Spice');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('stretch a little');
  await page.getByTestId('task-recur-row').click();
  await page.getByTestId('recur-mode-chance').click();
  await page.getByTestId('recur-chance-base').fill('100');
  await page.getByTestId('recur-chance-boost').fill('0');
  await page.getByTestId('recur-save').click();
  await page.getByTestId('task-collapse').click();
  // A normal MAX task alongside — at 100% the pepper must beat even it.
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('important thing');
  await page.getByTestId('priority-max').click();
  await page.waitForTimeout(250);
  await page.getByTestId('task-collapse').last().click();

  // Complete the pepper: it returns to the pool IMMEDIATELY — no rollover,
  // no reopen — that instant respawn is the mechanic (deterministic spawn
  // id, so the row simply reappears).
  const row = page.getByTestId(/^task-row-/).filter({ hasText: 'stretch a little' }).first();
  const id = (await row.getAttribute('data-testid'))!.replace('task-row-', '');
  await page.getByTestId(`task-check-${id}`).click();
  await expect(page.getByTestId(`task-row-${id}`)).toHaveCount(0);
  await expect(page.getByTestId(/^task-row-/).filter({ hasText: 'stretch a little' }),
    'back in the pool the moment it completes').toHaveCount(1);

  // And the randomizer serves it via the pepper roll, saying so.
  await page.getByTestId('back').click();
  await page.getByTestId('big-button').click();
  await expect(page.getByTestId('draw-card')).toContainText('stretch a little');
  await expect(page.getByTestId('draw-pepper')).toBeVisible();
});

test('the recurring screen can be re-ordered, and remembers which order', async ({ page }) => {
  // 2026-08-30 ask. Before this the rules arrived in storage order — which is
  // to say the order their random ids happened to land in.
  const rule = async (list: string, name: string) => {
    await page.getByTestId('new-task').click();
    await page.getByTestId('task-name-input').fill(name);
    await page.getByTestId('task-recur-row').click();
    await page.getByTestId('recur-mode-afterCompletion').click();
    await page.getByTestId('recur-interval').fill('2');
    await page.getByTestId('recur-save').click();
    await page.getByTestId('task-collapse').last().click();
    void list;
  };

  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Alpha');
  await page.getByTestId('new-list-input').press('Enter');
  await rule('Alpha', 'zebra rule');
  await page.getByTestId('back').click();
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Beta');
  await page.getByTestId('new-list-input').press('Enter');
  await rule('Beta', 'apple rule');
  await page.getByTestId('back').click();

  await page.getByTestId('recurring-link').click();
  // Default groups by list, with the list's own name as the heading.
  await expect(page.getByTestId('recurring-sort')).toContainText('by list');
  await expect(page.getByTestId('recurring-group-Alpha')).toBeVisible();
  await expect(page.getByTestId('recurring-group-Beta')).toBeVisible();

  // Cycling to a–z drops the headings and sorts across every list.
  await page.getByTestId('recurring-sort').click();
  await expect(page.getByTestId('recurring-sort')).toContainText('a–z');
  await expect(page.getByTestId('recurring-group-Alpha')).toHaveCount(0);
  const names = page.locator('[data-testid^="recurring-open-"] .name');
  await expect(names.first()).toHaveText('apple rule');

  // The choice is a setting, so it survives a reload.
  await page.reload();
  await expect(page.getByTestId('recurring-sort')).toContainText('a–z');
});
