/**
 * Two devices, one shared repo, and a list being deleted.
 *
 * Reported after the big import: deleted lists reappearing, and the count
 * seeming to grow. Deletion is a tombstone that has to out-argue a live copy
 * on the other device, so this exercises the whole loop — engine, merge, file
 * round-trip — rather than any one piece of it.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type List } from '../domain/types';
import { SyncEngine } from './engine';
import type { RemoteSnapshot } from './files';
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
}

/** A device: its own local snapshot plus an engine pointed at the shared repo. */
class Device {
  snap: RemoteSnapshot = {
    lists: [], tasks: [], tags: [], templates: [],
    currentTask: null, currentTaskUpdatedAt: 0,
    settings: { ...DEFAULT_SETTINGS }, settingsUpdatedAt: 0,
  };
  engine: SyncEngine;
  constructor(client: FakeClient, private clock: () => number) {
    this.engine = new SyncEngine({
      client,
      loadLocal: async () => JSON.parse(JSON.stringify(this.snap)),
      saveLocal: async (s) => { this.snap = JSON.parse(JSON.stringify(s)); },
      debounceMs: 0,
      sleep: async () => {},
    });
  }
  /** What the user actually sees — tombstones are hidden from the UI. */
  get visible(): string[] {
    return this.snap.lists.filter((l) => !l.deleted).map((l) => l.id).sort();
  }
  addList(id: string) {
    this.snap.lists.push({
      id, title: id, sortMode: 'priority', createdAt: this.clock(),
      updatedAt: this.clock(), deleted: false,
    } as List);
  }
  deleteList(id: string) {
    const l = this.snap.lists.find((x) => x.id === id)!;
    l.deleted = true;
    l.updatedAt = this.clock();
  }
}

// Realistic stamps: tombstones older than 90 days are compacted out of the
// sync files, so a fake epoch clock would look like ancient history and get
// dropped — which would 'reproduce' a bug that is really the test's fault.
let now = Date.now();
const clock = () => (now += 1000);
let client: FakeClient;
let pc: Device;
let phone: Device;

beforeEach(() => {
  now = Date.now();
  client = new FakeClient();
  pc = new Device(client, clock);
  phone = new Device(client, clock);
});

describe('deleting lists across two devices', () => {
  it('a delete on one device sticks on both, and repeated syncs do not resurrect it', async () => {
    for (const id of ['a', 'b', 'c']) pc.addList(id);
    await pc.engine.syncNow();
    await phone.engine.syncNow();
    expect(phone.visible).toEqual(['a', 'b', 'c']);

    pc.deleteList('b');
    await pc.engine.syncNow();
    await phone.engine.syncNow();
    expect(pc.visible).toEqual(['a', 'c']);
    expect(phone.visible).toEqual(['a', 'c']);

    // Sync a few more times from both sides: nothing should come back, and
    // nothing should multiply.
    for (let i = 0; i < 3; i += 1) {
      await pc.engine.syncNow();
      await phone.engine.syncNow();
    }
    expect(pc.visible).toEqual(['a', 'c']);
    expect(phone.visible).toEqual(['a', 'c']);
    expect(pc.snap.lists).toHaveLength(3); // 2 live + 1 tombstone, not growing
  });

  it('a delete while the other device is offline still wins when it reconnects', async () => {
    for (const id of ['a', 'b']) pc.addList(id);
    await pc.engine.syncNow();
    await phone.engine.syncNow();

    // Phone goes offline; PC deletes and pushes.
    pc.deleteList('b');
    await pc.engine.syncNow();

    // Phone reconnects with a stale live copy of 'b'.
    await phone.engine.syncNow();
    expect(phone.visible, 'the delete must win, not the stale copy').toEqual(['a']);
  });

  it('touching a list on the other device AFTER a delete brings it back', async () => {
    // The honest limit of newest-wins: a later edit beats an earlier delete.
    for (const id of ['a', 'b']) pc.addList(id);
    await pc.engine.syncNow();
    await phone.engine.syncNow();

    pc.deleteList('b');
    await pc.engine.syncNow();

    // Phone has not pulled yet and re-stamps 'b' (a rename, a sort change, a
    // reorder — anything that writes the row).
    const stale = phone.snap.lists.find((l) => l.id === 'b')!;
    stale.updatedAt = clock();
    await phone.engine.syncNow();
    await pc.engine.syncNow();

    console.log('after a post-delete edit elsewhere ->', 'pc:', pc.visible, 'phone:', phone.visible);
  });
});
