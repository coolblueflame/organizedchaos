/**
 * The 404 disambiguation on the root listing — the one place where "empty"
 * and "the token can no longer see the repo" arrive as the same status code.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AuthError, GithubClient } from './githubClient';

const client = () => new GithubClient({ owner: 'o', repo: 'r', token: 't' });

/** Stub fetch by URL shape: contents listing vs repo metadata. Returns the mock. */
function stubFetch(contentsStatus: number, repoStatus: number, listBody: unknown = []) {
  const mock = vi.fn(async (url: string) => {
    const isContents = url.includes('/contents/');
    const status = isContents ? contentsStatus : repoStatus;
    return new Response(status === 200 ? JSON.stringify(isContents ? listBody : {}) : null, { status });
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

afterEach(() => vi.unstubAllGlobals());

describe('GithubClient.listFiles', () => {
  it('lists files from a healthy repo', async () => {
    stubFetch(200, 200, [
      { path: 'active.json', sha: 'a1', type: 'file' },
      { path: 'docs', sha: 'd1', type: 'dir' },
    ]);
    expect(await client().listFiles()).toEqual([{ path: 'active.json', sha: 'a1' }]);
  });

  it('a 404 listing on an ACCESSIBLE repo means genuinely empty', async () => {
    stubFetch(404, 200);
    expect(await client().listFiles()).toEqual([]);
  });

  it('a 404 listing on an INVISIBLE repo is an auth failure, not an empty repo', async () => {
    // GitHub hides private repos from tokens that lost access (expired
    // fine-grained grant, revoked): both requests 404. Reading that as
    // "empty" wiped the file cache with no hint anything was wrong.
    stubFetch(404, 404);
    await expect(client().listFiles()).rejects.toThrow(AuthError);
    await expect(client().listFiles()).rejects.toThrow(/can’t see the sync repo/);
  });

  it('plain 401s stay auth errors without the extra request', async () => {
    const fetchMock = stubFetch(401, 200);
    await expect(client().listFiles()).rejects.toThrow(AuthError);
    expect(fetchMock.mock.calls).toHaveLength(1); // no metadata probe
  });
});
