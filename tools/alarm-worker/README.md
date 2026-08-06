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

## Setup

You will end up with: a free Cloudflare account running this Worker, a key
pair of your own, and two values pasted into the app's Settings. Budget
fifteen minutes. The free plan is far more than enough — 100,000
requests/day against the few dozen this uses.

**1. Make a Cloudflare account.** Sign up at
<https://dash.cloudflare.com/sign-up> (free plan; no domain or credit card
needed). Workers and Durable Objects are included.

**2. Deploy the Worker.** Clone this repo, then from this directory:

```sh
npm install
npx wrangler login          # opens a browser once, authorizes the CLI
npx wrangler deploy         # creates the Worker and the Durable Object
```

`wrangler.toml` already declares the binding and the migration, so the deploy
creates everything. Note the URL it prints
(`https://organizedchaos-alarms.<your-subdomain>.workers.dev`).

**3. Mint your keys.** Web push proves the sender's identity with a VAPID
key pair; the pair is yours, generated locally:

```sh
npx web-push generate-vapid-keys    # prints a public and a private key
openssl rand -base64 32             # and one long random ALARM_SECRET
```

**4. Give them to the Worker** (each command prompts for its value):

```sh
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put ALARM_SECRET
```

`ALARM_SECRET` is the bearer token the app will send — without it, a public
URL would let a stranger buzz your phone. The private key never goes
anywhere else.

**5. Point the app at it.** In Organized Chaos on the device that should
ring:

- Settings → **morning reminders** → *self-hosting? use your own push key* →
  paste the **public** key, then enable (or disable and re-enable)
  reminders on that device. Push subscriptions are cryptographically bound
  to the key they were created under, so this step is what lets *your*
  Worker send to *your* phone.
- Settings → **timebox alarms** → paste the Worker URL and the
  `ALARM_SECRET`. These sync, so entering them once is enough.

**6. Trust, then verify.** Start a short timebox, lock the phone, put it in
a pocket. The push should land within a second of the box expiring.

The same key pair can also power the morning digest — a scheduled GitHub
Action in your own sync repo running `tools/reminders/send.mjs` with the
pair in its Action secrets (see `tools/reminders/`).

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

Tested in the app's own suite:

- which alarms *should* exist for a given set of tasks, and the wording
  (`src/lib/domain/alarmPlan.ts`, 9 tests) — including that a locked list's
  task is never named, since this lands on a lock screen the PIN cannot gate;
- the Durable Object's own behaviour (`src/lib/domain/alarmWorker.test.ts`,
  6 tests) against a fake that mimics the real storage API, schedule through
  fire, cancel, and move.

That second suite exists because reviewing this file before deploying it found
two bugs, both of which would have failed **silently** — the alarm firing
exactly on time and doing nothing:

- the class constructor dropped `env`, where the VAPID keys live;
- `storage.get(keys[])` returns a **Map**, and the code destructured it as if
  it were an object, so every field read as `undefined`.

**Still not verified until deployed:** the push-sending call itself, which
needs real VAPID keys and a real subscription. Send one test timebox before
trusting it with anything that matters.
