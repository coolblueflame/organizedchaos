import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Priority, type Task } from '../domain/types';
import { mergeSnapshots } from './merge';
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
  queueIds: [], queueUpdatedAt: 0,
  ...over,
});

const taskNames = (s: RemoteSnapshot) => s.tasks.map((t) => `${t.id}:${t.name}`).sort();

describe('mergeSnapshots — entities', () => {
  it('newest updatedAt wins wholesale, both directions', () => {
    const base = task({ priority: 'low', name: 'old' });
    const localNewer = { ...base, name: 'local', updatedAt: 200 };
    const remoteNewer = { ...base, name: 'remote', updatedAt: 300 };
    const r1 = mergeSnapshots(snap({ tasks: [localNewer] }), snap({ tasks: [{ ...base }] }));
    expect(r1.merged.tasks[0]!.name).toBe('local');
    const r2 = mergeSnapshots(snap({ tasks: [{ ...base }] }), snap({ tasks: [remoteNewer] }));
    expect(r2.merged.tasks[0]!.name).toBe('remote');
  });

  it('one-sided entities survive in both directions', () => {
    const onlyLocal = task({ priority: 'low' });
    const onlyRemote = task({ priority: 'high' });
    const r = mergeSnapshots(snap({ tasks: [onlyLocal] }), snap({ tasks: [onlyRemote] }));
    expect(r.merged.tasks.map((t) => t.id).sort()).toEqual([onlyLocal.id, onlyRemote.id].sort());
  });

  it('a newer tombstone beats a stale edit (delete propagates)', () => {
    const base = task({ priority: 'low' });
    const editedStale = { ...base, name: 'edited', updatedAt: 150 };
    const deletedNewer = { ...base, deleted: true, updatedAt: 250 };
    const r = mergeSnapshots(snap({ tasks: [editedStale] }), snap({ tasks: [deletedNewer] }));
    expect(r.merged.tasks[0]!.deleted).toBe(true);
  });

  it('an edit newer than the tombstone resurrects', () => {
    const base = task({ priority: 'low' });
    const deletedOld = { ...base, deleted: true, updatedAt: 150 };
    const editedNew = { ...base, name: 'revived', updatedAt: 250, deleted: false };
    const r = mergeSnapshots(snap({ tasks: [deletedOld] }), snap({ tasks: [editedNew] }));
    expect(r.merged.tasks[0]!.deleted).toBe(false);
    expect(r.merged.tasks[0]!.name).toBe('revived');
  });

  it('equal timestamps deterministically prefer the tombstoned version', () => {
    const base = task({ priority: 'low' });
    const alive = { ...base, name: 'alive', updatedAt: 200 };
    const dead = { ...base, deleted: true, updatedAt: 200 };
    expect(mergeSnapshots(snap({ tasks: [alive] }), snap({ tasks: [dead] })).merged.tasks[0]!.deleted).toBe(true);
    expect(mergeSnapshots(snap({ tasks: [dead] }), snap({ tasks: [alive] })).merged.tasks[0]!.deleted).toBe(true);
  });

  it('merge outcome is symmetric', () => {
    const a = task({ priority: 'low', updatedAt: 500, name: 'A' });
    const b = { ...task({ priority: 'high' }), updatedAt: 300 };
    const onlyL = task({ priority: 'medium' });
    const L = snap({ tasks: [a, b, onlyL] });
    const R = snap({ tasks: [{ ...a, name: 'stale', updatedAt: 400 }, { ...b, name: 'newer', updatedAt: 600 }] });
    expect(taskNames(mergeSnapshots(L, R).merged)).toEqual(taskNames(mergeSnapshots(R, L).merged));
  });
});

describe('mergeSnapshots — singletons', () => {
  it('currentTask follows the newer stamp, including a newer null (clear propagates)', () => {
    const set = snap({ currentTask: { taskId: 'x', acceptedAt: 1 }, currentTaskUpdatedAt: 100 });
    const clearedNewer = snap({ currentTask: null, currentTaskUpdatedAt: 200 });
    const r = mergeSnapshots(set, clearedNewer);
    expect(r.merged.currentTask).toBeNull();
    expect(r.merged.currentTaskUpdatedAt).toBe(200);
  });

  it('settings follow the newer stamp', () => {
    const L = snap({ settings: { ...DEFAULT_SETTINGS, hoursPerDay: 2 }, settingsUpdatedAt: 300 });
    const R = snap({ settings: { ...DEFAULT_SETTINGS, hoursPerDay: 5 }, settingsUpdatedAt: 100 });
    expect(mergeSnapshots(L, R).merged.settings.hoursPerDay).toBe(2);
  });
});

describe('when merge keys tie, the honest clock decides', () => {
  // The exact 2026-07-29 shape: the import repair stamped a row at corrupt+1
  // with no editedAt; the phone, still holding the unrepaired base, edited it
  // and ALSO landed on corrupt+1 — but its write carries a real editedAt.
  const CORRUPT = new Date('2053-04-01').getTime();

  it("the user's edit beats the repair's re-stamp at the same merge key, both directions", () => {
    const repaired = task({ priority: 'medium', name: 'imported', updatedAt: CORRUPT });
    const userEdit = { ...repaired, priority: 'max' as Priority, editedAt: Date.now() };
    const r1 = mergeSnapshots(snap({ tasks: [userEdit] }), snap({ tasks: [{ ...repaired }] }));
    expect(r1.merged.tasks[0]!.priority).toBe('max');
    const r2 = mergeSnapshots(snap({ tasks: [{ ...repaired }] }), snap({ tasks: [userEdit] }));
    expect(r2.merged.tasks[0]!.priority).toBe('max');
  });

  it('two stamped edits at the same merge key: the later real-time edit wins', () => {
    const base = task({ priority: 'low', updatedAt: CORRUPT });
    const earlier = { ...base, priority: 'medium' as Priority, editedAt: 1000 };
    const later = { ...base, priority: 'max' as Priority, editedAt: 2000 };
    expect(mergeSnapshots(snap({ tasks: [earlier] }), snap({ tasks: [later] }))
      .merged.tasks[0]!.priority).toBe('max');
    expect(mergeSnapshots(snap({ tasks: [later] }), snap({ tasks: [earlier] }))
      .merged.tasks[0]!.priority).toBe('max');
  });

  it('a tombstone still beats an equal-stamp edit regardless of editedAt', () => {
    const base = task({ priority: 'low', updatedAt: CORRUPT });
    const edited = { ...base, priority: 'max' as Priority, editedAt: 2000 };
    const gone = { ...base, deleted: true, editedAt: 1000 };
    expect(mergeSnapshots(snap({ tasks: [edited] }), snap({ tasks: [gone] }))
      .merged.tasks[0]!.deleted).toBe(true);
  });
});

describe('singleton stamp ties converge on the same winner from both sides', () => {
  it('two devices that collided on a queue stamp both pick one order', () => {
    const a = snap({ queueIds: ['x', 'y'], queueUpdatedAt: 500 });
    const b = snap({ queueIds: ['y', 'x'], queueUpdatedAt: 500 });
    const fromA = mergeSnapshots(a, b).merged.queueIds;
    const fromB = mergeSnapshots(b, a).merged.queueIds;
    expect(fromA).toEqual(fromB); // whichever wins, they AGREE — no A/B/A flip-flop
  });

  it('same convergence for settings and currentTask', () => {
    const a = snap({
      settings: { ...DEFAULT_SETTINGS, hoursPerDay: 2 }, settingsUpdatedAt: 700,
      currentTask: { taskId: 't1', acceptedAt: 1 }, currentTaskUpdatedAt: 300,
    });
    const b = snap({
      settings: { ...DEFAULT_SETTINGS, hoursPerDay: 5 }, settingsUpdatedAt: 700,
      currentTask: { taskId: 't2', acceptedAt: 2 }, currentTaskUpdatedAt: 300,
    });
    const fromA = mergeSnapshots(a, b).merged;
    const fromB = mergeSnapshots(b, a).merged;
    expect(fromA.settings).toEqual(fromB.settings);
    expect(fromA.currentTask).toEqual(fromB.currentTask);
  });
});

describe('mergeSnapshots — the day queue singleton', () => {
  it('follows the newer stamp, both directions', () => {
    const mine = snap({ queueIds: ['a', 'b'], queueUpdatedAt: 200 });
    const theirs = snap({ queueIds: ['c'], queueUpdatedAt: 100 });
    expect(mergeSnapshots(mine, theirs).merged.queueIds).toEqual(['a', 'b']);
    expect(mergeSnapshots(theirs, mine).merged.queueIds).toEqual(['a', 'b']);
  });

  it('a pre-queue remote (stamp 0) never erases a planned day', () => {
    const planned = snap({ queueIds: ['a'], queueUpdatedAt: 5 });
    const oldRemote = snap();
    const r = mergeSnapshots(planned, oldRemote);
    expect(r.merged.queueIds).toEqual(['a']);
    expect(r.remoteChanged).toBe(true); // the queue must be pushed out
  });
});

describe('mergeSnapshots — change flags', () => {
  it('identical snapshots report no changes', () => {
    const t = task({ priority: 'low' });
    const r = mergeSnapshots(snap({ tasks: [{ ...t }] }), snap({ tasks: [{ ...t }] }));
    expect(r.localChanged).toBe(false);
    expect(r.remoteChanged).toBe(false);
  });

  it('remote-newer → localChanged only; local-newer → remoteChanged only', () => {
    const base = task({ priority: 'low' });
    const newer = { ...base, name: 'new', updatedAt: 999 };
    const pull = mergeSnapshots(snap({ tasks: [{ ...base }] }), snap({ tasks: [newer] }));
    expect(pull.localChanged).toBe(true);
    expect(pull.remoteChanged).toBe(false);
    const push = mergeSnapshots(snap({ tasks: [newer] }), snap({ tasks: [{ ...base }] }));
    expect(push.localChanged).toBe(false);
    expect(push.remoteChanged).toBe(true);
  });
});

describe('when both sides claim the same instant', () => {
  const row = (over = {}) => ({
    id: 'T1', listId: 'L1', name: 'x', notes: '', tagIds: [], priority: 'medium' as const,
    inProgress: false, createdAt: 0, updatedAt: 5_000, deleted: false, ...over,
  });
  const snapOf = (tasks: object[]) => ({
    lists: [], tasks: tasks as never, tags: [], templates: [],
    currentTask: null, currentTaskUpdatedAt: 0,
    settings: { ...DEFAULT_SETTINGS }, settingsUpdatedAt: 0,
    queueIds: [], queueUpdatedAt: 0,
  });

  it('resolves the same way whichever device is doing the merging', () => {
    // Writes clamp to max(now, current + 1), so two devices editing one
    // imported row while offline land on an identical stamp — common now,
    // where it used to take a millisecond collision. Preferring the local copy
    // would leave each device holding different content under the same stamp,
    // with nothing left to settle it.
    const mine = row({ name: 'renamed on the phone' });
    const theirs = row({ name: 'renamed on the laptop' });

    const onPhone = mergeSnapshots(snapOf([mine]), snapOf([theirs])).merged.tasks[0]!;
    const onLaptop = mergeSnapshots(snapOf([theirs]), snapOf([mine])).merged.tasks[0]!;
    expect(onPhone, 'both devices must land on the same row').toEqual(onLaptop);
  });

  it('still prefers the tombstone over a live edit at the same instant', () => {
    const alive = row({ name: 'edited' });
    const buried = row({ deleted: true });
    expect(mergeSnapshots(snapOf([alive]), snapOf([buried])).merged.tasks[0]!.deleted).toBe(true);
    expect(mergeSnapshots(snapOf([buried]), snapOf([alive])).merged.tasks[0]!.deleted).toBe(true);
  });

  it('treats identical rows as identical however their keys are ordered', () => {
    const a = { id: 'T1', name: 'same', updatedAt: 5_000, deleted: false, notes: 'n' };
    const b = { notes: 'n', deleted: false, updatedAt: 5_000, name: 'same', id: 'T1' };
    const result = mergeSnapshots(snapOf([a]), snapOf([b]));
    expect(result.localChanged, 'key order is not a difference').toBe(false);
    expect(result.remoteChanged).toBe(false);
  });
});
