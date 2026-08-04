# The alarm scheduler

A ~90-line Cloudflare Worker that holds a timebox appointment and sends the
push when it comes due. This is the only always-on piece the app has.

**The app does not require it.** Unconfigured or down, timeboxes work exactly
as they always have — the countdown runs, the alarm fires while the app is
open, and the watcher catches up when you return. This only adds the case the
app cannot cover itself: the phone locked in a pocket.

## Why a server at all

The app cannot promise a notification at an exact future moment. iOS suspends
the page, and the service worker only wakes when a push arrives. Something
reachable has to keep the appointment.

The web-standard way to schedule one locally — the Notification Triggers API —
was abandoned by Chrome and never existed in Safari (checked 2026-08-04).

## Why this is worth doing

Measured 2026-08-05, against a real iPhone:

| Condition | Delivered |
| --- | --- |
| Locked and pocketed ~20 min | 0.9s |
| Awake, app in foreground | 0.8s |

Effectively identical, so iOS was not throttling the idle case. A server that
fires on time therefore produces an alarm that rings on time.

Still unmeasured, and worth knowing before trusting it completely: dormancy
measured in hours rather than minutes, Low Power Mode, and poor signal. Fire a
probe any time with the `ping` mode of the reminders workflow — the
notification states its own delivery time.

## Setup (Ben)

1. **Create the Worker.** In the Cloudflare dashboard, Workers & Pages → Create
   → Worker. Any name; the URL it gives you is what the app needs.
2. **Bind the Durable Object.** Settings → Bindings → Durable Object, variable
   name `TIMEBOX_ALARM`, class `TimeboxAlarm`. A migration declaring the new
   class is required on first deploy — `wrangler` prompts for it.
3. **Add three secrets** (Settings → Variables and Secrets):
   - `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` — the same pair the reminders
     workflow uses, so pushes come from the identity the phone already trusts.
     They live in the data repo's Action secrets.
   - `ALARM_SECRET` — anything long and random. The app sends it as a bearer
     token; without it the endpoint would let a stranger buzz your phone.
4. **Paste the Worker URL and `ALARM_SECRET` into the app**, Settings → timebox
   alarms.

Free plan is far more than enough: 100,000 requests/day against a few dozen.

## The contract

`POST /` with `Authorization: Bearer <ALARM_SECRET>`:

```jsonc
// schedule (or move — setAlarm overwrites, so this is an upsert)
{ "taskId": "abc", "action": "set", "at": 1800000060000,
  "subscription": { /* the browser's PushSubscription */ },
  "title": "⏳ Timebox finished", "body": "\"water the plants\" — time's up." }

// cancel
{ "taskId": "abc", "action": "cancel" }
```

One Durable Object per task id, so a moved box overwrites its own alarm and
there is never a window where a stale one could still fire.

## What is and is not verified

Tested in the app's own suite: which alarms *should* exist for a given set of
tasks, and the wording (`src/lib/domain/alarmPlan.ts`, 9 tests) — including
that a locked list's task is never named, since this lands on a lock screen
the PIN cannot gate.

**Not verified until deployed:** the push-sending call itself. It cannot run
locally without real VAPID keys and a real subscription. Send one test timebox
before trusting it with anything that matters.
