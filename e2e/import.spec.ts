import { expect, test } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';
import initSqlJs from 'sql.js';

/**
 * End-to-end Things import against a SYNTHETIC fixture database built here in
 * node — real data never touches the repo. Chromium-only: the flow is
 * engine-agnostic and the wasm boot doubles the runtime on webkit.
 */
test.skip(({ browserName }) => browserName !== 'chromium', 'import flow is engine-agnostic');

const FIXTURE = 'test-results/things-fixture.sqlite';

test.beforeAll(async () => {
  const SQL = await initSqlJs();
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE TMTask (
      uuid TEXT PRIMARY KEY, type INTEGER, status INTEGER, trashed INTEGER,
      title TEXT, notes TEXT, creationDate REAL, userModificationDate REAL,
      stopDate REAL, start INTEGER, startDate INTEGER, deadline INTEGER,
      area TEXT, project TEXT, heading TEXT,
      rt1_recurrenceRule BLOB, rt1_repeatingTemplate TEXT, rt1_instanceCreationPaused INTEGER
    );
    CREATE TABLE TMArea (uuid TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE TMTag (uuid TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE TMTaskTag (tasks TEXT, tags TEXT);
    CREATE TABLE TMChecklistItem (uuid TEXT PRIMARY KEY, task TEXT, title TEXT, status INTEGER, "index" INTEGER);
  `);
  db.run("INSERT INTO TMArea VALUES ('A1', 'Homestead')");
  db.run(`INSERT INTO TMTask VALUES
    ('P1', 1, 0, 0, 'Greenhouse', NULL, 700000000, 700000000, NULL, 1, NULL, NULL, 'A1', NULL, NULL, NULL, NULL, NULL),
    ('T1', 0, 0, 0, 'repot the monstera', NULL, 700000001, 700000001, NULL, 1, NULL, NULL, NULL, 'P1', NULL, NULL, NULL, NULL),
    ('T2', 0, 3, 0, 'order soil', NULL, 700000002, 700000002, 700000010, 1, NULL, NULL, NULL, 'P1', NULL, NULL, NULL, NULL)`);
  mkdirSync('test-results', { recursive: true });
  const bytes = db.export();
  db.close();
  writeFileSync(FIXTURE, Buffer.from(bytes));
});

test('import a Things database end-to-end, and re-import stays idempotent', async ({ page }) => {
  await page.goto('./');
  await page.evaluate(
    () => new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase('organizedchaos');
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    }),
  );
  await page.reload();
  await page.getByTestId('new-list').waitFor();

  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-import').click();
  await page.getByTestId('import-file').setInputFiles(FIXTURE);
  await expect(page.getByTestId('import-preview')).toContainText('1 open tasks');
  await expect(page.getByTestId('import-preview')).toContainText('1 completed tasks');
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('import-done')).toBeVisible();
  await page.getByTestId('import-done').getByRole('button').click();

  await expect(page.getByTestId(/^list-row-/).first()).toContainText('Greenhouse');
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByText('repot the monstera')).toBeVisible();
  await page.getByTestId('back').click();
  await page.getByTestId('completed-link').click();
  await expect(page.getByText('order soil')).toBeVisible();
  await page.getByTestId('back').click();

  // Re-import the same file: nothing duplicates.
  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-import').click();
  await page.getByTestId('import-file').setInputFiles(FIXTURE);
  await page.getByTestId('import-run').click();
  await expect(page.getByTestId('import-done')).toBeVisible();
  await page.getByTestId('import-done').getByRole('button').click();
  await expect(page.getByTestId(/^list-row-/)).toHaveCount(1);
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByTestId(/^task-row-/)).toHaveCount(1);
});
