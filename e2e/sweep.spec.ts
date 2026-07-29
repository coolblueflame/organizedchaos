import { expect, test, type Page } from '@playwright/test';

test.skip(({ browserName }) => browserName !== 'chromium', 'sweep flows on chromium');

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

/** Imported-shaped backlog: open tasks wearing the review flag, oldest first. */
async function seedBacklog(page: Page, names: string[]) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Imported');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().waitFor();
  await page.evaluate(async (taskNames) => {
    const listId = (document.querySelector('[data-list-row]') as HTMLElement).dataset.listRow!;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('organizedchaos');
      open.onsuccess = () => {
        const store = open.result.transaction('tasks', 'readwrite').objectStore('tasks');
        taskNames.forEach((name, i) => {
          store.put({
            id: `imp${i}`, listId, name, notes: i === 0 ? 'some imported detail' : '',
            tagIds: [], priority: 'medium', inProgress: false, needsReview: true,
            createdAt: 1_500_000_000_000 + i * 86_400_000, updatedAt: Date.now() - 1000 + i,
            deleted: false,
          });
        });
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, names);
  await page.reload();
}

/** Triaged tasks with NO estimate — the estimate check's audience. */
async function seedUnestimated(page: Page, names: string[]) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Ready');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().waitFor();
  await page.evaluate(async (taskNames) => {
    const listId = (document.querySelector('[data-list-row]') as HTMLElement).dataset.listRow!;
    await new Promise<void>((resolve, reject) => {
      const open = indexedDB.open('organizedchaos');
      open.onsuccess = () => {
        const store = open.result.transaction('tasks', 'readwrite').objectStore('tasks');
        taskNames.forEach((name, i) => {
          store.put({
            id: `est${i}`, listId, name, notes: '',
            tagIds: [], priority: 'medium', inProgress: false, needsReview: false,
            createdAt: 1_500_000_000_000 + i * 86_400_000, updatedAt: Date.now() - 1000 + i,
            deleted: false,
          });
        });
        store.transaction.oncomplete = () => resolve();
        store.transaction.onerror = () => reject(store.transaction.error);
      };
      open.onerror = () => reject(open.error);
    });
  }, names);
  await page.reload();
}

test('the estimate check: confirm the hour, type the truth, or skip', async ({ page }) => {
  await reset(page);
  await seedUnestimated(page, ['paint the fence', 'clean gutters', 'mystery chore']);

  await page.goto('#/sweep/estimates');
  await page.reload(); // hash-only goto doesn't remount with fixtures
  await expect(page.getByTestId('sweep-mode-estimates')).toContainText('estimates · 3');

  // Oldest first: confirming 1h writes an EXPLICIT hour and advances.
  await expect(page.getByTestId('sweep-est-card')).toContainText('paint the fence');
  await page.getByTestId('est-confirm-hour').click();
  await expect(page.getByTestId('sweep-est-card')).toContainText('clean gutters');

  // A typed value saves and advances.
  await page.getByTestId('est-input').fill('2.5');
  await page.getByTestId('est-save').click();
  await expect(page.getByTestId('sweep-est-card')).toContainText('mystery chore');

  // Skip is session-only: the card moves on, the queue count does not shrink
  // into the "confirmed" tally.
  await page.getByTestId('est-skip').click();
  await expect(page.getByTestId('sweep-clear')).toBeVisible();
  await expect(page.getByTestId('sweep-tally')).toContainText('2 decided');

  // The confirmed values are real task data.
  await page.goto('#/');
  await page.getByTestId(/^list-row-/).first().click();
  await page.getByTestId(/^task-row-/).filter({ hasText: 'clean gutters' }).first().click();
  await expect(page.getByTestId('task-estimate-input').last()).toHaveValue('2.5');

  // The triage tab still shows its own queue (none here) and switching works.
  await page.goto('#/sweep');
  await page.reload(); // hash-only goto doesn't remount
  await expect(page.getByTestId('sweep-mode-triage')).toContainText('triage · 0');
  // The skipped task returns on a fresh visit — skips don't persist.
  await expect(page.getByTestId('sweep-mode-estimates')).toContainText('estimates · 1');
});

test('a full sweep session: every verdict does what it says', async ({ page }) => {
  await reset(page);
  await seedBacklog(page, ['ancient one', 'still relevant', 'do eventually', 'autumn thing', 'was done ages ago']);

  // The banner knows the backlog exists and leads here.
  await expect(page.getByTestId('sweep-banner')).toContainText('5 tasks never reviewed');
  await page.getByTestId('sweep-banner').click();
  await expect(page.getByTestId('sweep-tally')).toContainText('5 left');

  // Oldest first: 'ancient one', with its notes and age on show.
  await expect(page.getByTestId('sweep-card')).toContainText('ancient one');
  await expect(page.getByTestId('sweep-card')).toContainText('years old');
  await expect(page.getByTestId('sweep-notes'), 'notes are editable now — a VALUE, not text')
    .toHaveValue('some imported detail');
  await page.getByTestId('sweep-delete').click();

  await expect(page.getByTestId('sweep-card')).toContainText('still relevant');
  await page.getByTestId('sweep-priority-high').click(); // keep, filed as high

  await expect(page.getByTestId('sweep-card')).toContainText('do eventually');
  await page.getByTestId('sweep-priority-someday').click();

  await expect(page.getByTestId('sweep-card')).toContainText('autumn thing');
  await page.getByTestId('sweep-later').click();
  await page.getByTestId('sweep-snooze-91').click();

  await expect(page.getByTestId('sweep-card')).toContainText('was done ages ago');
  await page.getByTestId('sweep-done').click();

  // Queue drained; the tally kept score.
  await expect(page.getByTestId('sweep-clear')).toContainText('5 decisions');

  // And the world reflects each verdict.
  await page.getByTestId('back').click();
  await expect(page.getByTestId('sweep-banner'), 'banner retires with the backlog').toHaveCount(0);
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByText('ancient one', { exact: true })).toHaveCount(0);
  await expect(page.getByText('still relevant', { exact: true })).toBeVisible();
  const snoozedRow = page.getByTestId(/^task-row-/).filter({ hasText: 'autumn thing' }).first();
  const snoozedId = (await snoozedRow.getAttribute('data-testid'))!.replace('task-row-', '');
  await expect(page.getByTestId(`snoozed-mark-${snoozedId}`), 'a three-month sleep is visible').toBeVisible();
  await expect(page.getByTestId(/^needs-review-/), 'no yellow dots left in this list').toHaveCount(0);
});

test('a mis-tapped verdict is one "put it back" away', async ({ page }) => {
  await reset(page);
  await seedBacklog(page, ['fumbled']);
  await page.goto('./#/sweep');

  await page.getByTestId('sweep-priority-someday').click();
  await expect(page.getByTestId('sweep-clear')).toBeVisible();
  await page.getByTestId('sweep-putback').click();

  // Back in the queue, untouched.
  await expect(page.getByTestId('sweep-card')).toContainText('fumbled');
  await expect(page.getByTestId('sweep-tally')).toContainText('1 left');
});

test('a snoozed task wakes from its editor', async ({ page }) => {
  await reset(page);
  await seedBacklog(page, ['sleeper']);
  await page.goto('./#/sweep');
  await page.getByTestId('sweep-later').click();
  await page.getByTestId('sweep-snooze-30').click();

  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  await page.getByText('sleeper', { exact: true }).click();
  await expect(page.getByTestId('task-wake')).toContainText('asleep until');
  await page.getByTestId('task-wake').click();
  await expect(page.getByTestId('task-wake')).toHaveCount(0);
});

test('re-filing mid-sweep: pick a list once, then one tap per card', async ({ page }) => {
  await reset(page);
  await seedBacklog(page, ['watch that movie', 'try that game', 'call the dentist']);

  await page.goto('./#/sweep');

  // First move: create the destination without leaving the sweep.
  await expect(page.getByTestId('sweep-card')).toContainText('watch that movie');
  await page.getByTestId('sweep-move').selectOption('+ new list…');
  await page.getByTestId('sweep-new-list').fill('Wind-down');
  await page.getByTestId('sweep-new-list-go').click();

  // Second card: the destination is now a one-tap repeat.
  await expect(page.getByTestId('sweep-card')).toContainText('try that game');
  await expect(page.getByTestId('sweep-move-again')).toContainText('Wind-down');
  await page.getByTestId('sweep-move-again').click();

  // Third card stays put — an unrelated task keeps its ordinary verdicts.
  await expect(page.getByTestId('sweep-card')).toContainText('call the dentist');
  await page.getByTestId('sweep-keep').click();
  await expect(page.getByTestId('sweep-clear')).toContainText('3 decisions');

  // Both moved tasks live in the new list, reviewed; the dentist stayed home.
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).filter({ hasText: 'Wind-down' }).first().click();
  await expect(page.getByText('watch that movie', { exact: true })).toBeVisible();
  await expect(page.getByText('try that game', { exact: true })).toBeVisible();
  await expect(page.getByTestId(/^needs-review-/)).toHaveCount(0);
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).filter({ hasText: 'Imported' }).first().click();
  await expect(page.getByText('call the dentist', { exact: true })).toBeVisible();
});

test('the card is an editor: describe, estimate, and tag before the verdict', async ({ page }) => {
  await reset(page);
  await seedBacklog(page, ['bare imported task']);
  await page.goto('./#/sweep');

  await page.getByTestId('sweep-notes').fill('call ahead, they close at 5');
  await page.getByTestId('sweep-estimate').fill('2');
  await page.getByTestId('new-tag').click();
  await page.getByTestId('new-tag-input').fill('errands');
  await page.getByTestId('new-tag-input').press('Enter');
  await page.getByTestId('new-tag-done').click();
  await page.getByTestId('sweep-keep').click();
  await expect(page.getByTestId('sweep-clear')).toBeVisible();

  // Everything typed on the card lives on the task.
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  await page.getByText('bare imported task', { exact: true }).click();
  await expect(page.getByTestId('task-notes-input')).toHaveValue('call ahead, they close at 5');
  await expect(page.getByTestId('task-estimate-input')).toHaveValue('2');
  await expect(page.getByRole('button', { name: /errands/ })).toBeVisible();
});
