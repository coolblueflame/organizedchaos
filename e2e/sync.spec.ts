import { expect, test, type Page } from '@playwright/test';

/**
 * Full sync-protocol e2e against an in-memory fake of the GitHub Contents API,
 * installed via route interception — no network, real client code end-to-end
 * (fetch → CORS-shaped responses → base64 payloads → sha bookkeeping).
 */

interface FakeRepo {
  files: Map<string, { content: string; sha: string }>;
  seq: number;
}

function installFakeGithub(page: Page, repo: FakeRepo) {
  return page.route('https://api.github.com/**', async (route) => {
    const req = route.request();
    const url = new URL(req.url());
    const m = url.pathname.match(/^\/repos\/([^/]+)\/([^/]+)(?:\/contents\/?(.*))?$/);
    if (!m) return route.fulfill({ status: 404, json: { message: 'not found' } });
    const [, , , rawPath] = m;
    const hasContents = url.pathname.includes('/contents');

    if (!hasContents) return route.fulfill({ status: 200, json: { name: 'fake' } }); // checkAuth

    const path = decodeURIComponent(rawPath ?? '');
    if (req.method() === 'GET' && path === '') {
      const listing = [...repo.files.entries()].map(([p, f]) => ({ path: p, name: p, sha: f.sha, type: 'file' }));
      return route.fulfill({ status: 200, json: listing });
    }
    if (req.method() === 'GET') {
      const f = repo.files.get(path);
      if (!f) return route.fulfill({ status: 404, json: { message: 'not found' } });
      return route.fulfill({ status: 200, json: { content: f.content, sha: f.sha } });
    }
    if (req.method() === 'PUT') {
      const body = req.postDataJSON() as { content: string; sha?: string };
      const existing = repo.files.get(path);
      if (existing && existing.sha !== body.sha) {
        return route.fulfill({ status: 409, json: { message: 'sha mismatch' } });
      }
      if (!existing && body.sha) return route.fulfill({ status: 422, json: { message: 'sha for missing file' } });
      const sha = `sha-${++repo.seq}`;
      repo.files.set(path, { content: body.content, sha });
      return route.fulfill({ status: 201, json: { content: { sha } } });
    }
    return route.fulfill({ status: 405, json: {} });
  });
}

function fileJson(repo: FakeRepo, path: string): unknown {
  const f = repo.files.get(path);
  return f ? JSON.parse(Buffer.from(f.content, 'base64').toString('utf8')) : null;
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

async function connect(page: Page) {
  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-token').fill('github_pat_dummy');
  await page.getByTestId('settings-connect').click();
  await expect(page.getByTestId('settings-sync-status')).toContainText('idle');
}

async function seedTask(page: Page, name: string) {
  await page.getByTestId('new-list').click();
  await page.getByTestId('new-list-input').fill('Synced');
  await page.getByTestId('new-list-input').press('Enter');
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill(name);
  await page.getByTestId('task-collapse').click();
  await page.getByTestId('back').click();
}

test('local work pushes to the remote on connect', async ({ page }) => {
  const repo: FakeRepo = { files: new Map(), seq: 0 };
  await installFakeGithub(page, repo);
  await reset(page);
  await seedTask(page, 'first synced task');
  await connect(page);
  const active = fileJson(repo, 'active.json') as { tasks: Array<{ name: string }> };
  expect(active.tasks.map((t) => t.name)).toContain('first synced task');
  expect(fileJson(repo, 'meta.json')).toEqual({ schema: 1 });
});

test('a wiped device rehydrates everything from the remote', async ({ page }) => {
  const repo: FakeRepo = { files: new Map(), seq: 0 };
  await installFakeGithub(page, repo);
  await reset(page);
  await seedTask(page, 'precious data');
  await connect(page);

  // catastrophic local loss (or: a brand-new device)
  await reset(page);
  await expect(page.getByTestId(/^list-row-/)).toHaveCount(0);
  await connect(page);
  await page.getByTestId('back').click();
  await expect(page.getByTestId(/^list-row-/).first()).toContainText('Synced');
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByText('precious data')).toBeVisible();
});

test('remote changes from another device merge in on sync-now; disconnect keeps local alive', async ({ page }) => {
  const repo: FakeRepo = { files: new Map(), seq: 0 };
  await installFakeGithub(page, repo);
  await reset(page);
  await seedTask(page, 'mine');
  await connect(page);

  // another device edits the remote: inject a task with a far-future updatedAt
  const active = fileJson(repo, 'active.json') as { tasks: Array<Record<string, unknown>> };
  active.tasks.push({
    id: 'remote-task', listId: (active.tasks[0] as { listId: string }).listId,
    name: 'from the other device', notes: '', priority: 'high', tagIds: [],
    inProgress: false, createdAt: 1, updatedAt: Date.now() + 1_000_000, deleted: false,
  });
  repo.files.set('active.json', {
    content: Buffer.from(JSON.stringify(active)).toString('base64'),
    sha: `ext-${++repo.seq}`,
  });

  await page.getByTestId('settings-sync-now').click();
  await expect(page.getByTestId('settings-sync-status')).toContainText('idle');
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  await expect(page.getByText('from the other device')).toBeVisible();
  await page.getByTestId('back').click();

  // disconnect: purely local operation keeps working
  await page.getByTestId('settings-link').click();
  await page.getByTestId('settings-disconnect').click();
  await page.getByTestId('back').click();
  await page.getByTestId(/^list-row-/).first().click();
  await page.getByTestId('new-task').click();
  await page.getByTestId('task-name-input').fill('offline life goes on');
  await page.getByTestId('task-collapse').click();
  await expect(page.getByText('offline life goes on')).toBeVisible();
});
