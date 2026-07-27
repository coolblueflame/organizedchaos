# organized chaos

**A todo list with a gambling problem.**

Organized Chaos is a minimalist, dark-IDE-themed todo app whose signature feature is the
randomizer: one big button that looks at everything you could be doing, escalates priorities
based on deadlines and time estimates, draws one task from the top tier, and asks you to commit —
**Accept**, **Not Now** (re-roll), or **Not Today** (snooze until 4am). Accepted tasks become
your persistent current task. Completing things earns you particles.

**Live app:** https://coolblueflame.github.io/organizedchaos/

It works offline with local-first storage and syncs through a private GitHub repo — no server,
no subscription.

Built almost entirely by [Claude Code](https://claude.com/claude-code), design docs included.

## Install it on your phone

Organized Chaos runs fine in a browser tab, but it's meant to live on your home screen: full
screen with no browser bars, working offline, and — the part that actually matters — with
storage the browser is much less likely to clear out on its own.

Open the [live app](https://coolblueflame.github.io/organizedchaos/) on the device you want it
on, then:

**iPhone / iPad**

1. Make sure you're in **Safari**. Chrome and Edge also work from iOS 17 onward, but an in-app
   browser (a link opened inside Slack, Instagram, etc.) does not — use its `⋯` menu → **Open in
   Safari** first.
2. Tap the **Share** button — the square with an arrow out of the top. Bottom of the screen on
   iPhone, top on iPad.
3. **Scroll the share sheet down past the row of apps.** This is the step everyone misses: the
   option sits *below* the sharing targets, not among them.
4. Tap **Add to Home Screen**, then **Add**.

Apple gives web apps no way to trigger this themselves, so those four taps really are the only
route on iOS.

**Android**

1. Open it in **Chrome** (Edge, Brave and Samsung Internet behave the same).
2. Tap the `⋮` menu at the top right.
3. Choose **Install app** — or **Add to Home screen**, depending on your version.
4. Confirm with **Install**.

Chrome will often offer to do this for you; the app shows a one-tap install button when it does.

**Desktop**

Chrome/Edge: the install icon at the right-hand end of the address bar, or `⋮` → **Install
Organized Chaos**. Safari on macOS: **File** → **Add to Dock**. Firefox doesn't install web
apps — it keeps working as an ordinary tab.

The app itself explains all of this too: there's a prompt the first time you open it on a phone,
and it stays available afterwards under **Settings → this device**.

Installing doesn't move your data anywhere — same tasks, same browser storage, same device. To
get them onto a second device, set up sync in Settings.

## Development

```
npm install        # dependencies
npm run dev        # dev server
npm test           # unit tests (domain logic + storage)
npm run e2e        # Playwright end-to-end tests
npm run check      # svelte-check / TypeScript
npm run build      # production build
```

Design spec and implementation plans live in `docs/superpowers/`; the research that shaped the
architecture is in `docs/research/`.
