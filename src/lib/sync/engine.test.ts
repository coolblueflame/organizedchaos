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

function makeEngine() {
  return new SyncEngine({
    client,
    loadLocal: async () => local,
    saveLocal: async (s) => {
      local = s;
      saved.push(s);
    },
    debounceMs: 0,
  });
}

beforeEach(() => {
  client = new FakeClient();
  local = snap();
  saved = [];
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
