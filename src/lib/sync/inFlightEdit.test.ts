/**
 * What happens to work you do WHILE a sync is running.
 *
 * Reported: "the lists I delete keep reappearing." A cycle reads the local
 * snapshot, spends time on the network, then writes the merged result back.
 * With a large library that gap is seconds, not milliseconds, so a delete can
 * easily land inside it — and the write-back must not carry the pre-delete
 * copy of that row back into storage.
 *
 * These drive a REAL Repo through a REAL engine; only GitHub is faked.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { openDb, type AppDb } from '../storage/db';
import { Repo } from '../storage/repo';
import { SyncEngine } from './engine';
import type { RemoteFile, RemoteFileEntry } from './githubClient';

class FakeClient {
  files = new Map<string, { json: unknown; sha: string }>();
  private shaSeq = 0;
  async listFiles(): Promise<RemoteFileEntry[]> {
    return [...this.files.entries()].map(([path, f]) => ({ path, sha: f.sha }));
  }
  async getFile(path: string): Promise<RemoteFile | null> {
    const f = this.files.get(path);
    return f ? { json: JSON.parse(JSON.stringify(f.json)), sha: f.sha } : null;
  }
  async putFile(path: string, json: unknown): Promise<string> {
    const sha = `s${this.shaSeq++}`;
    this.files.set(path, { json: JSON.parse(JSON.stringify(json)), sha });
    return sha;
  }
  lists(): Array<{ id: string; deleted: boolean }> {
    return ((this.files.get('active.json')?.json as { lists?: Array<{ id: string; deleted: boolean }> })?.lists) ?? [];
  }
}

let db: AppDb;
let repo: Repo;
let client: FakeClient;
let dbN = 0;

beforeEach(() => {
  db = openDb(`inflight-${dbN++}`);
  repo = new Repo(db);
  client = new FakeClient();
});

/**
 * An engine whose local read optionally runs `race` immediately afterwards —
 * i.e. the user acts at the worst possible moment, after the snapshot has been
 * taken but before the merged result is written back.
 */
function engineWith(race?: () => Promise<void>) {
  let armed = Boolean(race);
  return new SyncEngine({
    client,
    loadLocal: async () => {
      const snap = await repo.loadSnapshot();
      if (armed) { armed = false; await race!(); }
      return snap;
    },
    saveLocal: (snap) => repo.replaceAll(snap),
    debounceMs: 0,
    sleep: async () => {},
  });
}

/** Something new on the remote, so the cycle has a reason to write locally. */
async function seedRemoteWithAnotherDevicesList(): Promise<void> {
  const other = new Repo(openDb('inflight-other'));
  await other.createList({ title: 'from the PC' });
  await new SyncEngine({
    client,
    loadLocal: () => other.loadSnapshot(),
    saveLocal: async () => {},
    debounceMs: 0,
    sleep: async () => {},
  }).syncNow();
}

describe('editing during an in-flight sync', () => {
  it('a list deleted mid-cycle stays deleted', async () => {
    const doomed = await repo.createList({ title: 'Doomed' });
    await engineWith().syncNow(); // both devices now know about it
    await seedRemoteWithAnotherDevicesList();

    await engineWith(() => repo.softDelete('lists', doomed.id)).syncNow();

    const visible = (await repo.loadState()).lists.map((l) => l.title);
    expect(visible, 'the delete must not be undone by the write-back').toEqual(['from the PC']);
  });

  it('and the delete still reaches the remote on the next sync', async () => {
    const doomed = await repo.createList({ title: 'Doomed' });
    await engineWith().syncNow();
    await seedRemoteWithAnotherDevicesList();

    await engineWith(() => repo.softDelete('lists', doomed.id)).syncNow();
    await engineWith().syncNow();

    const remote = client.lists().find((l) => l.id === doomed.id);
    expect(remote?.deleted, 'a tombstone the other device will honour').toBe(true);
  });

  it('a task completed mid-cycle stays completed', async () => {
    const list = await repo.createList({ title: 'Chores' });
    const task = await repo.createTask({
      listId: list.id, name: 'mow the lawn', notes: '', priority: 'medium',
      tagIds: [], inProgress: false,
    });
    await engineWith().syncNow();
    await seedRemoteWithAnotherDevicesList();

    await engineWith(() => repo.updateTask(task.id, { completedAt: Date.now() })).syncNow();

    const back = (await repo.loadState()).tasks.find((t) => t.id === task.id);
    expect(back?.completedAt, 'ticking it off is not undone by a sync').toBeDefined();
  });
});
