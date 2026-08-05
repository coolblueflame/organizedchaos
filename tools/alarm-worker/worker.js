/**
 * The alarm scheduler: the one always-on piece this app has.
 *
 * WHY IT EXISTS. A timebox needs a notification at an exact future moment,
 * and nothing in the app can promise that — iOS suspends the page, and the
 * service worker only runs when a push arrives. Something reachable has to
 * hold the appointment. Measured 2026-08-05: a web push reaches a locked,
 * pocketed iPhone in ~0.9s, so a server that fires on time is a real timer.
 *
 * WHY IT IS ALLOWED TO EXIST, given this project's "no hosting" rule: the app
 * must work completely without it. Unconfigured or unreachable, timeboxes
 * behave exactly as they always have — the countdown runs, the alarm fires
 * while the app is open, and the watcher catches up on return. This only ever
 * ADDS the case the app cannot cover itself.
 *
 * Deploy: see README.md in this directory.
 */

/** One Durable Object per scheduled alarm, named by the task id. */
export class TimeboxAlarm {
  /**
   * Both arguments matter. An earlier draft took only the state and lost
   * `env`, which is where the VAPID keys live — every alarm would have fired
   * and then failed to send, with nothing in the app to explain why.
   */
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }

  async fetch(request) {
    const { action, at, subscription, title, body } = await request.json();

    if (action === 'cancel') {
      await this.ctx.storage.deleteAlarm();
      await this.ctx.storage.deleteAll();
      return new Response('cancelled');
    }

    if (typeof at !== 'number' || !subscription) {
      return new Response('at and subscription required', { status: 400 });
    }

    // setAlarm OVERWRITES any existing alarm on this object, which is exactly
    // what a moved timebox wants — no cancel-then-reschedule dance, and no
    // window where the old alarm could still fire.
    await this.ctx.storage.put({ subscription, title, body });
    await this.ctx.storage.setAlarm(at);
    return new Response('scheduled');
  }

  async alarm() {
    /*
      get(keys[]) answers with a MAP, not an object. Destructuring it the way
      you would an object yields undefined for everything, so this method would
      have found no subscription and returned quietly — the alarm firing
      correctly, on time, and doing nothing, with no error anywhere to say so.
    */
    const stored = await this.ctx.storage.get(['subscription', 'title', 'body']);
    const subscription = stored.get('subscription');
    if (!subscription) return; // cancelled and emptied; a late alarm is not an error

    // Deleted only after a successful send: alarms retry on throw, and losing
    // the subscription first would turn one failure into silence forever.
    await this.sendPush(subscription, {
      title: stored.get('title'),
      body: stored.get('body'),
    });
    await this.ctx.storage.deleteAll();
  }

  /** A method so tests can substitute it without touching the push library. */
  async sendPush(subscription, { title, body }) {
    // Imported here rather than at module scope so this file can be loaded by
    // the app's test suite without the Worker's own dependencies present.
    // Wrangler bundles dynamic imports fine.
    const { buildPushPayload } = await import('@block65/webcrypto-web-push');
    const init = await buildPushPayload(
      {
        data: JSON.stringify({ title, body, tag: 'timebox' }),
        options: { ttl: 300, urgency: 'high' },
      },
      subscription,
      {
        subject: 'mailto:ben@noodlecake.com',
        publicKey: this.env.VAPID_PUBLIC_KEY,
        privateKey: this.env.VAPID_PRIVATE_KEY,
      },
    );
    const res = await fetch(subscription.endpoint, init);
    // Throwing lets the Durable Object's own retry take over; swallowing it
    // would drop the alarm silently, which is the failure mode this whole
    // feature exists to avoid.
    if (!res.ok && res.status !== 410) {
      throw new Error(`push rejected: ${res.status}`);
    }
  }
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('POST only', { status: 405 });

    // The endpoint is public, so a shared secret keeps strangers from firing
    // notifications at someone's phone. Low stakes, but free to prevent.
    if (request.headers.get('authorization') !== `Bearer ${env.ALARM_SECRET}`) {
      return new Response('nope', { status: 401 });
    }

    // clone() so the body is still readable by the Durable Object below.
    const { taskId } = await request.clone().json();
    if (!taskId) return new Response('taskId required', { status: 400 });

    const id = env.TIMEBOX_ALARM.idFromName(taskId);
    return env.TIMEBOX_ALARM.get(id).fetch(request);
  },
};
