/**
 * The alarm Worker runs on Cloudflare, not here — but it is plain JavaScript,
 * and the parts that were wrong were wrong about the RUNTIME'S API rather than
 * about logic. So the fake below deliberately mimics Durable Object storage
 * faithfully (notably: get(keys[]) answers with a Map, not an object). Both
 * bugs this file now guards against were silent — the alarm fired on time and
 * did nothing, with no error anywhere to explain it.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — plain .js Worker module without type declarations
import { TimeboxAlarm as RawTimeboxAlarm } from '../../../tools/alarm-worker/worker.js';

/** The Worker is untyped JS, so state its contract here and hold it to that. */
interface AlarmObject {
  env: unknown;
  fetch(request: Request): Promise<Response>;
  alarm(): Promise<void>;
  sendPush(subscription: unknown, payload: { title?: string; body?: string }): Promise<void>;
}
const TimeboxAlarm = RawTimeboxAlarm as new (ctx: unknown, env: unknown) => AlarmObject;

/** Storage that behaves like the real thing in the ways that bit us. */
function fakeCtx() {
  const map = new Map<string, unknown>();
  let alarmAt: number | null = null;
  return {
    storage: {
      put: async (entries: Record<string, unknown>) => {
        for (const [k, v] of Object.entries(entries)) map.set(k, v);
      },
      // The real API returns a Map for an array of keys.
      get: async (keys: string[]) => new Map(keys.map((k) => [k, map.get(k)])),
      deleteAll: async () => void map.clear(),
      setAlarm: async (at: number) => void (alarmAt = at),
      deleteAlarm: async () => void (alarmAt = null),
    },
    peek: () => ({ map, alarmAt }),
  };
}

const ENV = { VAPID_PUBLIC_KEY: 'pub', VAPID_PRIVATE_KEY: 'priv' };
const SUB = { endpoint: 'https://push.example/abc', keys: { p256dh: 'x', auth: 'y' } };

/** A subclass that records the send instead of reaching for the push library. */
function armed(ctx: ReturnType<typeof fakeCtx>) {
  const sent: Array<{ subscription: unknown; title?: string; body?: string }> = [];
  class Testable extends TimeboxAlarm {
    async sendPush(subscription: unknown, payload: { title?: string; body?: string }) {
      sent.push({ subscription, ...payload });
    }
  }
  return { obj: new Testable(ctx, ENV), sent };
}

const post = (body: unknown) => new Request('https://alarm/', {
  method: 'POST', body: JSON.stringify(body),
});

describe('TimeboxAlarm', () => {
  it('keeps env — the VAPID keys live there', () => {
    // An earlier draft took only the state, so every alarm fired and then
    // failed to send with nothing to explain why.
    const obj = new TimeboxAlarm(fakeCtx(), ENV);
    expect(obj.env).toBe(ENV);
  });

  it('schedules, then sends exactly what was stored when the alarm fires', async () => {
    const ctx = fakeCtx();
    const { obj, sent } = armed(ctx);
    await obj.fetch(post({ action: 'set', at: 1_800_000_060_000, subscription: SUB, title: 'T', body: 'B' }));
    expect(ctx.peek().alarmAt).toBe(1_800_000_060_000);

    await obj.alarm();
    expect(sent).toEqual([{ subscription: SUB, title: 'T', body: 'B' }]);
  });

  it('clears its storage after a successful send', async () => {
    const ctx = fakeCtx();
    const { obj } = armed(ctx);
    await obj.fetch(post({ action: 'set', at: 1, subscription: SUB, title: 'T', body: 'B' }));
    await obj.alarm();
    expect(ctx.peek().map.size).toBe(0);
  });

  it('a cancelled box sends nothing, even if a late alarm still lands', async () => {
    const ctx = fakeCtx();
    const { obj, sent } = armed(ctx);
    await obj.fetch(post({ action: 'set', at: 1, subscription: SUB, title: 'T', body: 'B' }));
    await obj.fetch(post({ action: 'cancel' }));
    expect(ctx.peek().alarmAt).toBeNull();

    await obj.alarm();
    expect(sent).toEqual([]);
  });

  it('moving a box overwrites the alarm rather than adding one', async () => {
    const ctx = fakeCtx();
    const { obj, sent } = armed(ctx);
    await obj.fetch(post({ action: 'set', at: 100, subscription: SUB, title: 'T', body: 'first' }));
    await obj.fetch(post({ action: 'set', at: 999, subscription: SUB, title: 'T', body: 'second' }));
    expect(ctx.peek().alarmAt).toBe(999);

    await obj.alarm();
    expect(sent).toHaveLength(1);
    expect(sent[0]!.body).toBe('second');
  });

  it('refuses a schedule with no time or no subscription', async () => {
    const { obj } = armed(fakeCtx());
    expect((await obj.fetch(post({ action: 'set', subscription: SUB }))).status).toBe(400);
    expect((await obj.fetch(post({ action: 'set', at: 1 }))).status).toBe(400);
  });
});
