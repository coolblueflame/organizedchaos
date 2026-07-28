/**
 * Live round-trip against the REAL GitHub Contents API — inert unless a token
 * is supplied, so CI never touches the network:
 *
 *   OC_LIVE_TOKEN=$(gh auth token) npx vitest run src/lib/sync/live.manual.test.ts
 *
 * Everything happens under `_selftest/` — a subfolder, which the sync engine's
 * root-only listing can never see — and is deleted afterwards, so a real data
 * repo is never polluted.
 */
import { afterAll, describe, expect, it } from 'vitest';
import { ConflictError, GithubClient, type SyncConfig } from './githubClient';

const TOKEN = process.env.OC_LIVE_TOKEN ?? '';
const CFG: SyncConfig = {
  owner: process.env.OC_LIVE_OWNER ?? 'coolblueflame',
  repo: process.env.OC_LIVE_REPO ?? 'organizedchaos-data',
  token: TOKEN,
};
const PATH = `_selftest/roundtrip-${Date.now()}.json`;
const BIG_PATH = `_selftest/big-${Date.now()}.json`;

afterAll(async () => {
  if (!TOKEN) return;
  for (const path of [PATH, BIG_PATH]) {
    const head = await fetch(
      `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${path}`,
      { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' } },
    );
    if (!head.ok) continue;
    const { sha } = (await head.json()) as { sha: string };
    await fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${path}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
      body: JSON.stringify({ message: 'selftest cleanup', sha }),
    });
  }
});

describe.skipIf(!TOKEN)('GithubClient against live GitHub', () => {
  const client = new GithubClient(CFG);

  it('authenticates against a real repo', async () => {
    expect(await client.checkAuth()).toEqual({ ok: true });
  });

  it('reports a missing file as null, not an error', async () => {
    expect(await client.getFile(`_selftest/definitely-not-here-${Date.now()}.json`)).toBeNull();
  });

  it('round-trips unicode-bearing JSON and returns a usable sha', async () => {
    const payload = { hello: 'world', unicode: '日本語 — émoji 🎲🔥', nested: { n: [1, 2, 3] } };
    const sha = await client.putFile(PATH, payload);
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const read = await client.getFile(PATH);
    expect(read?.json).toEqual(payload);
    expect(read?.sha).toBe(sha);
  });

  it('rejects a stale sha with ConflictError and accepts the current one', async () => {
    const current = await client.getFile(PATH);
    const stale = '0'.repeat(40);
    await expect(client.putFile(PATH, { v: 2 }, stale)).rejects.toBeInstanceOf(ConflictError);
    const next = await client.putFile(PATH, { v: 2 }, current!.sha);
    expect(next).not.toBe(current!.sha);
    expect((await client.getFile(PATH))?.json).toEqual({ v: 2 });
  });

  it('omitting the sha for an EXISTING file is a conflict, not a silent overwrite', async () => {
    // The engine relies on this: a first-write race must not clobber.
    await expect(client.putFile(PATH, { v: 3 })).rejects.toBeInstanceOf(ConflictError);
  });

  it('root listing cannot see subfolder files (why _selftest is safe)', async () => {
    const files = await client.listFiles();
    expect(files.some((f) => f.path === PATH)).toBe(false);
  });

  it('rejects a bad token with a clear message', async () => {
    const bad = new GithubClient({ ...CFG, token: 'github_pat_definitely_invalid' });
    const res = await bad.checkAuth();
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });
});

describe.skipIf(!TOKEN)('a logbook bigger than the inline limit', () => {
  const client = new GithubClient(CFG);

  it('round-trips a file over 1MB, which the Contents API will not inline', async () => {
    // The exact shape that broke syncing after a 25,000-task import: past 1MB
    // GitHub answers 200 with an EMPTY content field and encoding "none", so
    // the old decode produced "" and JSON.parse died. Only a real request
    // proves the fallback works — no amount of mocking would have caught it.
    const rows = Array.from({ length: 9_000 }, (_, i) => ({
      id: `task-${i}`, name: `a task with a reasonably long name ${i}`,
      notes: 'padding so the file comfortably clears one megabyte '.repeat(2),
      updatedAt: 1_700_000_000_000 + i, deleted: false,
    }));
    const payload = { schema: 1, tasks: rows };
    const bytes = new TextEncoder().encode(JSON.stringify(payload, null, 2)).length;
    expect(bytes, 'fixture must actually exceed the 1MB inline limit')
      .toBeGreaterThan(1_048_576);

    await client.putFile(BIG_PATH, payload);
    const back = await client.getFile(BIG_PATH);
    expect(back).not.toBeNull();
    expect((back!.json as typeof payload).tasks).toHaveLength(9_000);
    expect((back!.json as typeof payload).tasks[8_999]!.name).toBe(rows[8_999]!.name);
  }, 120_000);
});
