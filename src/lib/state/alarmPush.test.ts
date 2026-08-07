/**
 * The client half of the alarm scheduler: the diff runner that keeps the
 * Worker in step. The Worker itself is tested in alarmWorker.test.ts; these
 * prove the runner's contract — what gets sent, when nothing gets sent, and
 * that failure only ever costs a retry.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { List, Priority, Settings, Task } from '../domain/types';
import { resetAlarmLedger, syncAlarms } from './alarmPush.svelte';

const NOW = 1_800_000_000_000;
let n = 0;
const task = (over: Partial<Task> = {}): Task => ({
  id: `t${n++}`, listId: 'L1', name: 'boxed', notes: '', tagIds: [],
  priority: 'medium' as Priority, inProgress: false,
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});
const SETTINGS = {
  hoursPerDay: 1, slackBandDays: 3, rolloverHour: 4, autoSelectNext: false,
  alarmWorkerUrl: 'https://alarms.example', alarmWorkerSecret: 's3cret',
} as Settings;

function harness(status = 200) {
  const sent: Array<{ url: string; body: Record<string, unknown> }> = [];
  const send = vi.fn(async (url: RequestInfo | URL, init?: RequestInit) => {
    sent.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response('', { status });
  }) as unknown as typeof fetch;
  return { sent, send };
}

beforeEach(() => {
  // A device-local storage for the persisted ledger (jsdom-free fake).
  const store = new Map<string, string>();
  vi.stubGlobal('localStorage', {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  });
  resetAlarmLedger();
  // A push subscription exists on this "device".
  vi.stubGlobal('navigator', {
    serviceWorker: {
      getRegistration: async () => ({
        pushManager: {
          getSubscription: async () => ({
            toJSON: () => ({ endpoint: 'https://push.example/x', keys: { p256dh: 'p', auth: 'a' } }),
          }),
        },
      }),
    },
  });
});

describe('syncAlarms', () => {
  it('does nothing at all when not configured — the no-hosting promise', async () => {
    const { sent, send } = harness();
    await syncAlarms([task({ timeboxEndsAt: NOW + 60_000 })], [], {
      ...SETTINGS, alarmWorkerUrl: undefined, alarmWorkerSecret: undefined,
    }, NOW, send);
    expect(sent).toEqual([]);
  });

  it('schedules a live box once, then stays quiet', async () => {
    const { sent, send } = harness();
    const t = task({ timeboxEndsAt: NOW + 60_000, name: 'water plants' });
    await syncAlarms([t], [], SETTINGS, NOW, send);
    await syncAlarms([t], [], SETTINGS, NOW + 1000, send);
    await syncAlarms([t], [], SETTINGS, NOW + 2000, send);
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toMatchObject({
      taskId: t.id, action: 'set', at: NOW + 60_000,
    });
    expect(String(sent[0]!.body.body)).toContain('water plants');
  });

  it('cancels when the box goes away', async () => {
    const { sent, send } = harness();
    const t = task({ timeboxEndsAt: NOW + 60_000 });
    await syncAlarms([t], [], SETTINGS, NOW, send);
    await syncAlarms([{ ...t, timeboxEndsAt: undefined }], [], SETTINGS, NOW + 1000, send);
    expect(sent).toHaveLength(2);
    expect(sent[1]!.body).toMatchObject({ taskId: t.id, action: 'cancel' });
  });

  it('never names a task from a locked list', async () => {
    const { sent, send } = harness();
    const lists = [{ id: 'SECRET', title: 'x', sortMode: 'priority', createdAt: 0, updatedAt: 0, deleted: false, locked: true } as List];
    const t = task({ listId: 'SECRET', timeboxEndsAt: NOW + 60_000, name: 'the private thing' });
    await syncAlarms([t], lists, SETTINGS, NOW, send);
    expect(String(sent[0]!.body.body)).not.toContain('private thing');
  });

  it('an alarm scheduled before a reload is still cancelled after it', async () => {
    // Ben's 2026-08-06 report: complete a boxed task early and the push
    // arrives anyway at the would-have-expired moment. The ledger was
    // session-local — a reload emptied it, and cancels only ever come FROM
    // the ledger, so the Worker's appointment could never be taken back.
    const t = task({ timeboxEndsAt: NOW + 60_000 });
    const before = harness();
    await syncAlarms([t], [], SETTINGS, NOW, before.send);
    expect(before.sent).toHaveLength(1); // scheduled, ledger persisted

    resetAlarmLedger(true); // the reload: memory gone, device ledger kept

    // The task was completed ahead of its box; the fresh session must
    // remember enough to send the cancel.
    const after = harness();
    await syncAlarms([{ ...t, completedAt: NOW + 5_000, timeboxEndsAt: undefined }],
      [], SETTINGS, NOW + 6_000, after.send);
    expect(after.sent).toHaveLength(1);
    expect(after.sent[0]!.body).toMatchObject({ taskId: t.id, action: 'cancel' });
  });

  it('a failed send is retried by the next sweep, a confirmed one is not', async () => {
    const t = task({ timeboxEndsAt: NOW + 60_000 });
    const fail = harness(500);
    await syncAlarms([t], [], SETTINGS, NOW, fail.send);
    expect(fail.sent).toHaveLength(1); // tried…

    const ok = harness(200);
    await syncAlarms([t], [], SETTINGS, NOW + 1000, ok.send);
    await syncAlarms([t], [], SETTINGS, NOW + 2000, ok.send);
    expect(ok.sent).toHaveLength(1); // …retried once, then settled
  });
});
