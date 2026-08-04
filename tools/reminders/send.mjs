/**
 * Sends the morning digest as Web Push. Runs INSIDE the data repo's Actions
 * cron with two checkouts side by side:
 *   ./data — the private data repo (active.json, push-subscriptions.json)
 *   ./app  — this public repo (for this script + digest.mjs)
 * Env: VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, OC_TZ (IANA zone).
 * `web-push` is installed ephemerally by the workflow, never committed here.
 */
import { readFileSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { buildDigest, buildPing, localDayKey } from './digest.mjs';

const require = createRequire(process.cwd() + '/');
const webpush = require('web-push');

const tz = process.env.OC_TZ || 'America/Regina';
const subsPath = 'data/push-subscriptions.json';

/*
  'send'    — the real digest (what the cron does; no input is passed there)
  'dry-run' — everything up to the send, nothing to anyone's phone. The DEFAULT
              for manual dispatches, because a verification run once sent a
              real subscriber a duplicate morning digest.
  'ping'    — a timestamped latency probe, ignoring whether anything is due.
*/
const mode = process.env.OC_MODE || 'send';

if (!existsSync(subsPath)) {
  console.log('no push-subscriptions.json — nobody has enabled reminders yet');
  process.exit(0);
}
const subs = JSON.parse(readFileSync(subsPath, 'utf8'));
if (!Array.isArray(subs) || subs.length === 0) {
  console.log('no subscriptions registered');
  process.exit(0);
}

let payload;
if (mode === 'ping') {
  payload = buildPing(new Date(), tz);
} else {
  const active = JSON.parse(readFileSync('data/active.json', 'utf8'));
  payload = buildDigest(active.tasks ?? [], active.lists ?? [], localDayKey(new Date(), tz));
  if (!payload) {
    console.log('nothing due — no push today');
    process.exit(0);
  }
}

if (mode === 'dry-run') {
  console.log(`DRY RUN — would push to ${subs.length} device(s):`, payload.body);
  process.exit(0);
}

webpush.setVapidDetails(
  'mailto:ben@noodlecake.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

const body = JSON.stringify({
  title: payload.title, body: payload.body, tag: payload.tag,
  // Only probes carry this; the service worker turns it into a measured
  // delivery time on the notification itself.
  ...(payload.sentAt ? { sentAt: payload.sentAt } : {}),
});
// High urgency: a real alarm would use it, so the measurement has to. iOS may
// hold a low-urgency push for a convenient moment, which is fine for a morning
// digest and fatal for a timer.
const options = { urgency: 'high', TTL: 300 };
let sent = 0;
for (const sub of subs) {
  try {
    await webpush.sendNotification(sub.subscription, body, options);
    sent += 1;
  } catch (err) {
    // 404/410 = the device unsubscribed or the endpoint died; the app rewrites
    // the file wholesale on every enable/disable, so stale rows age out there.
    console.log(`push to "${sub.device ?? 'device'}" failed: ${err.statusCode ?? err.message}`);
  }
}
console.log(`${mode} sent to ${sent}/${subs.length} device(s) at ${new Date().toISOString()}:`, payload.body);
