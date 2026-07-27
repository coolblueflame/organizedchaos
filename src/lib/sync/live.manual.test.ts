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

afterAll(async () => {
  if (!TOKEN) return;
  const head = await fetch(
    `https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${PATH}`,
    { headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' } },
  );
  if (!head.ok) return;
  const { sha } = (await head.json()) as { sha: string };
  await fetch(`https://api.github.com/repos/${CFG.owner}/${CFG.repo}/contents/${PATH}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${TOKEN}`, Accept: 'application/vnd.github+json' },
    body: JSON.stringify({ message: 'selftest cleanup', sha }),
  });
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
