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

  async getFile(path: string): Promise<RemoteFile | null> {
    const res = await fetch(this.url(path), { headers: this.headers() });
    if (res.status === 404) return null;
    if (res.status === 401 || res.status === 403) throw new AuthError(`GitHub auth failed (${res.status})`);
    if (!res.ok) throw new Error(`GitHub get ${path} failed: ${res.status}`);
    const body = (await res.json()) as { content: string; sha: string };
    return { json: JSON.parse(fromB64(body.content)), sha: body.sha };
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
