import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { List, Priority, Task } from '../domain/types';
import { checkTimeboxes, resetTimeboxLedger } from './timeboxWatch.svelte';

// The watcher reaches for browser toys on fire; none of them may be required.
vi.mock('./fx/particles', () => ({ burstAt: () => {}, motionOk: () => false }));
vi.mock('./fx/haptics', () => ({ haptic: () => {} }));

const NOW = 1_800_000_000_000;
let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${n++}`, listId: 'L1', name: 'boxed', notes: '', tagIds: [],
  priority: 'medium' as Priority, inProgress: false,
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});
const lists: List[] = [];

beforeEach(() => {
  resetTimeboxLedger();
  vi.stubGlobal('Notification', undefined);
  vi.stubGlobal('navigator', {});
  vi.stubGlobal('window', {});
});

describe('checkTimeboxes', () => {
  it('announces a box whose time has passed', () => {
    const fired: string[] = [];
    checkTimeboxes([task({ timeboxEndsAt: NOW - 1 })], lists, (t) => fired.push(t.id), NOW);
    expect(fired).toHaveLength(1);
  });

  it('stays quiet while the box is still running', () => {
    const fired: string[] = [];
    checkTimeboxes([task({ timeboxEndsAt: NOW + 60_000 })], lists, (t) => fired.push(t.id), NOW);
    expect(fired).toEqual([]);
  });

  it('announces once, however often it is swept', () => {
    // The watcher ticks every second; the alarm must not repeat every tick.
    const t = task({ timeboxEndsAt: NOW - 1 });
    const fired: string[] = [];
    for (let i = 0; i < 5; i += 1) checkTimeboxes([t], lists, (x) => fired.push(x.id), NOW + i);
    expect(fired).toHaveLength(1);
  });

  it('a re-armed box is a NEW alarm', () => {
    const t = task({ timeboxEndsAt: NOW - 1 });
    const fired: string[] = [];
    checkTimeboxes([t], lists, (x) => fired.push(x.id), NOW);
    const again = { ...t, timeboxEndsAt: NOW + 500 };
    checkTimeboxes([again], lists, (x) => fired.push(x.id), NOW + 600);
    expect(fired).toHaveLength(2);
  });

  it('ignores boxes on finished or deleted tasks', () => {
    const fired: string[] = [];
    checkTimeboxes([
      task({ timeboxEndsAt: NOW - 1, completedAt: NOW - 500 }),
      task({ timeboxEndsAt: NOW - 1, deleted: true }),
    ], lists, (t) => fired.push(t.id), NOW);
    expect(fired).toEqual([]);
  });

  it('raises no system notification while you are looking at the app', async () => {
    /*
      2026-08-30, iOS, app open at expiry: two banners. The scheduled push
      lands as a system notification, and the watcher was raising one of its
      own beside it. A system notification is for reaching someone who is
      NOT looking; on screen, the app already says so with the chime, the
      confetti and its own line.
    */
    const shown: string[] = [];
    const notification = { permission: 'granted' };
    vi.stubGlobal('Notification', notification);
    vi.stubGlobal('window', { Notification: notification }); // the guard reads `in window`
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: async () => ({ showNotification: (t: string) => shown.push(t) }),
      },
    });
    vi.stubGlobal('document', { visibilityState: 'visible' });

    const fired: string[] = [];
    checkTimeboxes([task({ timeboxEndsAt: NOW - 1 })], lists, (t) => fired.push(t.id), NOW);
    await Promise.resolve();
    await Promise.resolve();
    expect(fired, 'the alarm itself still happens').toHaveLength(1);
    expect(shown, 'but not a second banner over the push').toEqual([]);
  });

  it('still raises one when the app is out of sight', async () => {
    const shown: string[] = [];
    const notification = { permission: 'granted' };
    vi.stubGlobal('Notification', notification);
    vi.stubGlobal('window', { Notification: notification });
    vi.stubGlobal('navigator', {
      serviceWorker: {
        getRegistration: async () => ({ showNotification: (t: string) => shown.push(t) }),
      },
    });
    vi.stubGlobal('document', { visibilityState: 'hidden' });

    checkTimeboxes([task({ timeboxEndsAt: NOW - 1 })], lists, () => {}, NOW);
    await Promise.resolve();
    await Promise.resolve();
    expect(shown, 'nobody is watching the screen — say it out loud').toHaveLength(1);
  });

  it('catches up on a box that expired while the app was away', () => {
    // iOS freezes our timers when backgrounded; the sweep on resume is the
    // whole point — an hour-old deadline still announces itself.
    const fired: string[] = [];
    checkTimeboxes([task({ timeboxEndsAt: NOW - 3_600_000 })], lists, (t) => fired.push(t.id), NOW);
    expect(fired).toHaveLength(1);
  });
});
