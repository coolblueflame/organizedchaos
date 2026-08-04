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
  constructor(state) {
    this.state = state;
  }

  async fetch(request) {
    const { action, at, subscription, title, body } = await request.json();

    if (action === 'cancel') {
      await this.state.storage.deleteAlarm();
      await this.state.storage.deleteAll();
      return new Response('cancelled');
    }

    // setAlarm OVERWRITES any existing alarm on this object, which is exactly
    // what a moved timebox wants — no cancel-then-reschedule dance, and no
    // window where the old alarm could still fire.
    await this.state.storage.put({ subscription, title, body });
    await this.state.storage.setAlarm(at);
    return new Response('scheduled');
  }

  async alarm() {
    const { subscription, title, body } = await this.state.storage.get([
      'subscription', 'title', 'body',
    ]);
    // A cancelled-then-emptied object can still see one late alarm; nothing to
    // send is not an error.
    if (!subscription) return;
    await sendPush(this.state.env ?? this.env, subscription, { title, body });
    await this.state.storage.deleteAll();
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

    const payload = await request.clone().json();
    if (!payload.taskId) return new Response('taskId required', { status: 400 });

    const id = env.TIMEBOX_ALARM.idFromName(payload.taskId);
    return env.TIMEBOX_ALARM.get(id).fetch(request);
  },
};

/**
 * Web Push from a Worker. `web-push` is Node-only; this runtime has WebCrypto,
 * so the encryption and the VAPID JWT come from a library built for it.
 */
async function sendPush(env, subscription, { title, body }) {
  const { buildPushPayload } = await import('@block65/webcrypto-web-push');
  const message = {
    data: JSON.stringify({ title, body, tag: 'timebox' }),
    options: { ttl: 300, urgency: 'high' },
  };
  const vapid = {
    subject: 'mailto:ben@noodlecake.com',
    publicKey: env.VAPID_PUBLIC_KEY,
    privateKey: env.VAPID_PRIVATE_KEY,
  };
  const init = await buildPushPayload(message, subscription, vapid);
  await fetch(subscription.endpoint, init);
}
