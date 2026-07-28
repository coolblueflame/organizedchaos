import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS, type Priority, type Task } from '../domain/types';
import { ConflictError, type RemoteFile, type RemoteFileEntry } from './githubClient';
import { SyncEngine } from './engine';
import type { RemoteSnapshot } from './files';

let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'L1', name: `task-${n}`, notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 100, deleted: false, ...over,
});

const snap = (over: Partial<RemoteSnapshot> = {}): RemoteSnapshot => ({
  lists: [], tasks: [], tags: [], templates: [],
  currentTask: null, currentTaskUpdatedAt: 0,
  settings: { ...DEFAULT_SETTINGS }, settingsUpdatedAt: 0,
  ...over,
});

/** In-memory GitHub Contents fake with real sha-conflict semantics. */
class FakeClient {
  files = new Map<string, { json: unknown; sha: string }>();
  putCount = 0;
  failNetwork = false;
  /** When set, the next N puts conflict (simulating a racing writer). */
  conflictNext = 0;
  private shaSeq = 0;

  async listFiles(): Promise<RemoteFileEntry[]> {
    if (this.failNetwork) throw new TypeError('fetch failed');
    return [...this.files.entries()].map(([path, f]) => ({ path, sha: f.sha }));
  }

  async getFile(path: string): Promise<RemoteFile | null> {
    if (this.failNetwork) throw new TypeError('fetch failed');
    const f = this.files.get(path);
    return f ? { json: JSON.parse(JSON.stringify(f.json)), sha: f.sha } : null;
  }

  async putFile(path: string, json: unknown, sha?: string): Promise<string> {
    if (this.failNetwork) throw new TypeError('fetch failed');
    this.putCount += 1;
    if (this.conflictNext > 0) {
      this.conflictNext -= 1;
      throw new ConflictError('simulated race');
    }
    const existing = this.files.get(path);
    if (existing && existing.sha !== sha) throw new ConflictError('sha mismatch');
    if (!existing && sha) throw new ConflictError('sha for missing file');
    const newSha = `sha-${++this.shaSeq}`;
    this.files.set(path, { json: JSON.parse(JSON.stringify(json)), sha: newSha });
    return newSha;
  }

  /** Test helper: an external writer changes active.json out from under the engine. */
  externallyWrite(path: string, json: unknown) {
    this.files.set(path, { json, sha: `ext-${++this.shaSeq}` });
  }

  activeTasks(): Task[] {
    return ((this.files.get('active.json')?.json as { tasks: Task[] } | undefined)?.tasks) ?? [];
  }
}

let client: FakeClient;
let local: RemoteSnapshot;
let saved: RemoteSnapshot[];

let slept: number[];

function makeEngine() {
  return new SyncEngine({
    client,
    loadLocal: async () => local,
    saveLocal: async (s) => {
      local = s;
      saved.push(s);
    },
    debounceMs: 0,
    sleep: async (ms) => { slept.push(ms); }, // no real waiting in tests
  });
}

beforeEach(() => {
  client = new FakeClient();
  local = snap();
  saved = [];
  slept = [];
});

describe('SyncEngine', () => {
  it('first sync pushes everything to an empty remote', async () => {
    local = snap({ tasks: [task({ priority: 'high' })] });
    const engine = makeEngine();
    await engine.syncNow();
    expect(engine.status).toBe('idle');
    expect(client.files.has('active.json')).toBe(true);
    expect(client.files.has('meta.json')).toBe(true);
    expect(client.activeTasks()).toHaveLength(1);
    expect(saved).toHaveLength(0); // nothing remote was newer
  });

  it('pull-only when remote is newer: saves locally, pushes nothing', async () => {
    const t = task({ priority: 'high', updatedAt: 999, name: 'from-remote' });
    client.externallyWrite('active.json', {
      schema: 1, lists: [], tasks: [t], tags: [], templates: [],
      currentTask: null, currentTaskUpdatedAt: 0,
      settings: { ...DEFAULT_SETTINGS }, settingsUpdatedAt: 0,
    });
    client.externallyWrite('meta.json', { schema: 1 });
    const engine = makeEngine();
    await engine.syncNow();
    expect(local.tasks[0]!.name).toBe('from-remote');
    expect(client.putCount).toBe(0);
  });

  it('unchanged state produces zero puts', async () => {
    local = snap({ tasks: [task({ priority: 'low' })] });
    const engine = makeEngine();
    await engine.syncNow();
    const afterFirst = client.putCount;
    await engine.syncNow();
    expect(client.putCount).toBe(afterFirst); // second cycle: no diffs, no puts
  });

  it('recovers from a put conflict by re-pulling and retrying', async () => {
    local = snap({ tasks: [task({ priority: 'high', name: 'mine', updatedAt: 500 })] });
    client.conflictNext = 1; // first put loses the race
    const engine = makeEngine();
    await engine.syncNow();
    expect(engine.status).toBe('idle');
    expect(client.activeTasks().map((t) => t.name)).toContain('mine');
  });

  it('backs off before each retry (GitHub reads are eventually consistent)', async () => {
    local = snap({ tasks: [task({ priority: 'high' })] });
    client.conflictNext = 2;
    const engine = makeEngine();
    await engine.syncNow();
    expect(engine.status).toBe('idle');
    // One wait per retry, increasing. The waits are deliberately long: a
    // large library takes seconds per cycle, and the old millisecond-scale
    // budget expired while the other device was still mid-push.
    expect(slept).toEqual([500, 1500]);
  });

  it('gives up after repeated conflicts with status error', async () => {
    local = snap({ tasks: [task({ priority: 'high' })] });
    client.conflictNext = 99;
    const engine = makeEngine();
    await engine.syncNow();
    expect(engine.status).toBe('error');
  });

  it('network failure → offline, local untouched', async () => {
    local = snap({ tasks: [task({ priority: 'high' })] });
    client.failNetwork = true;
    const engine = makeEngine();
    await engine.syncNow();
    expect(engine.status).toBe('offline');
    expect(saved).toHaveLength(0);
  });

  it('debounce coalesces a burst of requestSync calls into one cycle', async () => {
    vi.useFakeTimers();
    local = snap({ tasks: [task({ priority: 'high' })] });
    const engine = new SyncEngine({
      client,
      loadLocal: async () => local,
      saveLocal: async (s) => { local = s; },
      debounceMs: 4000,
    });
    engine.requestSync();
    engine.requestSync();
    engine.requestSync();
    await vi.advanceTimersByTimeAsync(4100);
    expect(client.putCount).toBeGreaterThan(0);
    const count = client.putCount;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.putCount).toBe(count); // exactly one coalesced cycle
    vi.useRealTimers();
  });
});

describe('download caching', () => {
  /** Counts every GET so the saving is measured, not asserted by eye. */
  function countingEngine(cache: { value: Record<string, { sha: string; json: unknown }> }) {
    const gets: string[] = [];
    const engine = new SyncEngine({
      client: {
        listFiles: () => client.listFiles(),
        getFile: (p) => { gets.push(p); return client.getFile(p); },
        putFile: (p, j, s) => client.putFile(p, j, s),
      },
      loadLocal: async () => local,
      saveLocal: async (s) => { local = s; },
      debounceMs: 0,
      sleep: async () => {},
      loadCache: async () => cache.value,
      saveCache: async (c) => { cache.value = c; },
    });
    return { engine, gets };
  }

  it('re-downloads nothing when the remote has not moved', async () => {
    // Seed the remote first — a fresh repo has nothing to download, so a
    // first-sync-fetches assertion against an empty one proves nothing.
    local = snap({ tasks: [task({ priority: 'high', completedAt: 1_700_000_000_000 })] });
    await makeEngine().syncNow();

    const cache = { value: {} as Record<string, { sha: string; json: unknown }> };
    const first = countingEngine(cache);
    await first.engine.syncNow();
    expect(first.gets.length, 'a cold cache must actually fetch').toBeGreaterThan(0);

    // Nothing changed anywhere. A second sync should read the listing and stop.
    const second = countingEngine(cache);
    await second.engine.syncNow();
    expect(second.gets, 'unchanged files must not be fetched again').toEqual([]);
  });

  it('fetches only the file that actually changed', async () => {
    local = snap({ tasks: [task({ priority: 'high', completedAt: 1_700_000_000_000 })] });
    await makeEngine().syncNow();
    const cache = { value: {} as Record<string, { sha: string; json: unknown }> };
    await countingEngine(cache).engine.syncNow();

    // Another device rewrites just the active file.
    client.externallyWrite('active.json', {
      schema: 1, lists: [], tasks: [], tags: [], templates: [],
      currentTask: null, currentTaskUpdatedAt: 0,
      settings: { ...DEFAULT_SETTINGS }, settingsUpdatedAt: 0,
    });

    const next = countingEngine(cache);
    await next.engine.syncNow();
    expect(next.gets, 'only the moved file').toEqual(['active.json']);
  });

  it('recognises its own push instead of downloading it straight back', async () => {
    local = snap({ tasks: [task({ priority: 'high' })] });
    const cache = { value: {} as Record<string, { sha: string; json: unknown }> };
    await countingEngine(cache).engine.syncNow(); // pushes

    local = snap({ tasks: [task({ priority: 'low', name: 'newer', updatedAt: 9_999 })] });
    const after = countingEngine(cache);
    await after.engine.syncNow(); // pushes again
    expect(after.gets, 'our own writes are already known').toEqual([]);
  });

  it('drops cache entries for files that disappeared from the repo', async () => {
    local = snap({ tasks: [task({ priority: 'high', completedAt: 1_700_000_000_000 })] });
    await makeEngine().syncNow();
    const cache = { value: {} as Record<string, { sha: string; json: unknown }> };
    await countingEngine(cache).engine.syncNow();
    expect(Object.keys(cache.value).length).toBeGreaterThan(1);

    client.files.delete('meta.json');
    await countingEngine(cache).engine.syncNow();
    expect(Object.keys(cache.value)).not.toContain('meta.json');
  });
});
