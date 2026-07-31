import { describe, expect, it } from 'vitest';
import type { Priority, Task } from '../domain/types';
import { fromFiles, SCHEMA_VERSION, SchemaTooNewError, toFiles, type RemoteSnapshot } from './files';

const now = new Date('2026-07-26T12:00:00');

let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'L1', name: `task-${n}`, notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: now.getTime(), deleted: false, ...over,
});

const snap = (over: Partial<RemoteSnapshot> = {}): RemoteSnapshot => ({
  lists: [], tasks: [], tags: [], templates: [],
  currentTask: null, currentTaskUpdatedAt: 0,
  settings: {}, settingsUpdatedAt: 0,
    queueIds: [], queueUpdatedAt: 0,
  ...over,
});

describe('toFiles / fromFiles', () => {
  it('round-trips a full snapshot', () => {
    const s = snap({
      tasks: [
        task({ priority: 'high' }),
        task({ priority: 'low', completedAt: new Date('2026-07-20T10:00:00').getTime() }),
      ],
      currentTask: { taskId: 't0', acceptedAt: 5 },
      currentTaskUpdatedAt: 99,
      settingsUpdatedAt: 42,
    });
    const files = toFiles(s, now);
    const back = fromFiles(files);
    expect(back.tasks.map((t) => t.id).sort()).toEqual(s.tasks.map((t) => t.id).sort());
    expect(back.currentTask).toEqual(s.currentTask);
    expect(back.currentTaskUpdatedAt).toBe(99);
    expect(back.settingsUpdatedAt).toBe(42);
  });

  it('splits open tasks into active.json and completed into per-year logbooks', () => {
    const open = task({ priority: 'high' });
    const done26 = task({ priority: 'low', completedAt: new Date('2026-03-01T10:00:00').getTime() });
    const done25 = task({ priority: 'low', completedAt: new Date('2025-12-30T10:00:00').getTime() });
    const files = toFiles(snap({ tasks: [open, done26, done25] }), now) as Record<string, { tasks: Task[] }>;
    expect(files['active.json']!.tasks.map((t) => t.id)).toEqual([open.id]);
    expect(files['logbook-2026.json']!.tasks.map((t) => t.id)).toEqual([done26.id]);
    expect(files['logbook-2025.json']!.tasks.map((t) => t.id)).toEqual([done25.id]);
  });

  it('drops tombstones older than 90 days, keeps younger ones', () => {
    const fresh = task({ priority: 'low', deleted: true, updatedAt: now.getTime() - 10 * 86_400_000 });
    const stale = task({ priority: 'low', deleted: true, updatedAt: now.getTime() - 91 * 86_400_000 });
    const files = toFiles(snap({ tasks: [fresh, stale] }), now);
    const back = fromFiles(files);
    expect(back.tasks.map((t) => t.id)).toEqual([fresh.id]);
  });

  it('tolerates missing files (fresh remote)', () => {
    const back = fromFiles({});
    expect(back.tasks).toEqual([]);
    expect(back.currentTask).toBeNull();
    // Sparse, NOT default-filled: a fresh remote has no settings choices, and
    // inventing defaults here is how old-version defaults got frozen into
    // synced blobs. Defaults belong to the read edge (repo.getSettings).
    expect(back.settings).toEqual({});
  });

  it('round-trips settings sparse — never materializing defaults', () => {
    const files = toFiles(snap({ settings: { hoursPerDay: 3 } }), now);
    const active = files['active.json'] as { settings: Record<string, unknown> };
    expect(active.settings).toEqual({ hoursPerDay: 3 });
    expect(fromFiles(files).settings).toEqual({ hoursPerDay: 3 });
  });

  it('rejects a future schema version', () => {
    expect(() => fromFiles({ 'meta.json': { schema: SCHEMA_VERSION + 1 } }))
      .toThrow(SchemaTooNewError);
  });
});
