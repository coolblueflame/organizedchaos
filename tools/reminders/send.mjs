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
import { buildDigest, localDayKey } from './digest.mjs';

const require = createRequire(process.cwd() + '/');
const webpush = require('web-push');

const tz = process.env.OC_TZ || 'America/Regina';
const subsPath = 'data/push-subscriptions.json';

if (!existsSync(subsPath)) {
  console.log('no push-subscriptions.json — nobody has enabled reminders yet');
  process.exit(0);
}
const subs = JSON.parse(readFileSync(subsPath, 'utf8'));
if (!Array.isArray(subs) || subs.length === 0) {
  console.log('no subscriptions registered');
  process.exit(0);
}

const active = JSON.parse(readFileSync('data/active.json', 'utf8'));
const digest = buildDigest(active.tasks ?? [], active.lists ?? [], localDayKey(new Date(), tz));
if (!digest) {
  console.log('nothing due — no push today');
  process.exit(0);
}

// Dry run: everything up to the actual send, nothing to anyone's phone.
// Manual workflow dispatches default to this — a real subscriber got a
// duplicate morning digest from a verification dispatch on 2026-08-01,
// which is exactly once too often.
if (process.env.OC_DRY_RUN === 'true') {
  console.log(`DRY RUN — would push to ${subs.length} device(s):`, digest.body);
  process.exit(0);
}

webpush.setVapidDetails(
  'mailto:ben@noodlecake.com',
  process.env.VAPID_PUBLIC_KEY,
  process.env.VAPID_PRIVATE_KEY,
);

const payload = JSON.stringify({ title: digest.title, body: digest.body, tag: digest.tag });
let sent = 0;
for (const sub of subs) {
  try {
    await webpush.sendNotification(sub.subscription, payload);
    sent += 1;
  } catch (err) {
    // 404/410 = the device unsubscribed or the endpoint died; the app rewrites
    // the file wholesale on every enable/disable, so stale rows age out there.
    console.log(`push to "${sub.device ?? 'device'}" failed: ${err.statusCode ?? err.message}`);
  }
}
console.log(`digest sent to ${sent}/${subs.length} device(s):`, digest.body);
