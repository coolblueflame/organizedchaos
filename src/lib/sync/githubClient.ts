/**
 * Thin typed wrapper over the GitHub Contents API (spec §8). CORS + the
 * Authorization preflight were verified against api.github.com on 2026-07-26.
 * Content is base64 of pretty-printed JSON so the data repo's git diffs stay
 * human-readable (each sync = one reviewable commit per changed file).
 */

export interface SyncConfig {
  owner: string;
  repo: string;
  token: string;
}

export interface RemoteFile {
  json: unknown;
  sha: string;
}

export interface RemoteFileEntry {
  path: string;
  sha: string;
}

/** PUT lost the optimistic-concurrency race — caller re-pulls, re-merges, retries. */
export class ConflictError extends Error {}

/** Anything auth-shaped (bad/expired/mis-scoped token, wrong repo). */
export class AuthError extends Error {}

/** UTF-8-safe base64 (btoa alone chokes on non-Latin1 task names). */
function toB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

function fromB64(b64: string): string {
  const bin = atob(b64.replace(/\s/g, ''));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

export class GithubClient {
  constructor(private cfg: SyncConfig) {}

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    };
  }

  private url(path: string): string {
    return `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}/contents/${path}`;
  }

  /** Root listing — how the engine discovers which logbook-<year> files exist. */
  async listFiles(): Promise<RemoteFileEntry[]> {
    const res = await fetch(this.url(''), { headers: this.headers() });
    if (res.status === 404) return []; // empty repo has no contents listing
    if (res.status === 401 || res.status === 403) throw new AuthError(`GitHub auth failed (${res.status})`);
    if (!res.ok) throw new Error(`GitHub list failed: ${res.status}`);
    const rows = (await res.json()) as Array<{ path: string; sha: string; type: string }>;
    return rows.filter((r) => r.type === 'file').map((r) => ({ path: r.path, sha: r.sha }));
  }

  /**
   * Files over 1MB do not come back inline.
   *
   * The Contents API only base64-encodes content up to 1MB; past that it still
   * answers 200 with an EMPTY `content` and `encoding: "none"`, so decoding it
   * yields "" and JSON.parse dies with "unexpected end of data". That is not
   * hypothetical — importing a real Things logbook pushed one file past the
   * line and broke syncing entirely.
   *
   * The blob endpoint serves the same object up to 100MB, and the listing we
   * already fetch hands us the sha, so the fallback costs one extra request
   * and only for the files that need it.
   */
  private async getBlobText(sha: string): Promise<string> {
    const res = await fetch(
      `https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}/git/blobs/${sha}`,
      { headers: { ...this.headers(), Accept: 'application/vnd.github.raw' } },
    );
    if (res.status === 401 || res.status === 403) throw new AuthError(`GitHub auth failed (${res.status})`);
    if (!res.ok) throw new Error(`GitHub blob ${sha} failed: ${res.status}`);
    return res.text();
  }

  async getFile(path: string): Promise<RemoteFile | null> {
    const res = await fetch(this.url(path), { headers: this.headers() });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new AuthError(`GitHub auth failed (${res.status})`);
    if (!res.ok) throw new Error(`GitHub get ${path} failed: ${res.status}`);
    const body = (await res.json()) as {
      content?: string; encoding?: string; sha: string; size?: number;
    };
    // Keyed off the symptom (no content) rather than `encoding === 'base64'`:
    // that field is what the docs promise, but keying on its presence makes
    // every ordinary read depend on a header being exactly right, and sends
    // perfectly inline files down the blob path when it is not.
    const text = body.content ? fromB64(body.content) : await this.getBlobText(body.sha);
    if (text === '') {
      // Better than a bare JSON.parse error naming neither the file nor why.
      throw new Error(
        `GitHub returned no content for ${path} (${body.size ?? '?'} bytes). ` +
        'Files over 100MB cannot be synced through this API.',
      );
    }
    return { json: JSON.parse(text), sha: body.sha };
  }

  async putFile(path: string, json: unknown, sha?: string): Promise<string> {
    const res = await fetch(this.url(path), {
      method: 'PUT',
      headers: { ...this.headers(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: `sync: ${path}`,
        content: toB64(JSON.stringify(json, null, 2)),
        ...(sha ? { sha } : {}),
      }),
    });
    if (res.status === 409 || res.status === 422) throw new ConflictError(`sha conflict on ${path}`);
    if (res.status === 401 || res.status === 403) throw new AuthError(`GitHub auth failed (${res.status})`);
    if (!res.ok) throw new Error(`GitHub put ${path} failed: ${res.status}`);
    const body = (await res.json()) as { content: { sha: string } };
    return body.content.sha;
  }

  /** Pre-flight for the Settings "connect" button. */
  async checkAuth(): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch(`https://api.github.com/repos/${this.cfg.owner}/${this.cfg.repo}`, {
        headers: this.headers(),
      });
      if (res.ok) return { ok: true };
      if (res.status === 401) return { ok: false, error: 'Token rejected — check it was copied fully.' };
      if (res.status === 404) return { ok: false, error: 'Repo not found — check owner/name, and that the token can access it.' };
      return { ok: false, error: `GitHub answered ${res.status}` };
    } catch {
      return { ok: false, error: 'Network error — offline?' };
    }
  }
}
