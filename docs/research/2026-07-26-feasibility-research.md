# Feasibility research — 2026-07-26

Six parallel research agents investigated the market and technical landscape before any
architecture decisions were made. Condensed findings below; confidence noted where it matters.

## Market: does this app already exist?

**No.** The niche exists but nothing implements the signature mechanic (deadline-based priority
escalation → random pick within the highest tier → Accept / "Not today" snooze → persistent
current task):

- **Just One Task** (iOS, $29.99 lifetime) — closest match; one-task-at-a-time UX, but "random
  mode" is a naive queue shuffle. Dormant since Sep 2023.
- **Task-Shuffler** (iOS, free) — shuffles tasks into weekly time slots; hobby-grade, dormant since 2023.
- **RandomTask** (web, subscription) — 6-slot dice roller, free tier capped at 3 sessions/day.
- **Task Roulette Pro** (iOS, free) — multi-person party game, not a todo app.
- Mainstream apps (Things, Todoist, TickTick, Lunatask) have no random-task feature.

Aside: since Things 3.17, Apple Shortcuts *can* read Things tasks (Find Items / Edit Items), so a
crude random-picker Shortcut is possible — but Things has no priority field and no escalation,
so it can't replicate the real mechanic.

## PWA on iOS (the delivery decision)

Verified against official WebKit documentation:

- Home-screen web apps are **exempt from the 7-day script-writable-storage eviction** (they have
  their own days-of-use counter). Source: webkit.org/tracking-prevention/
- `navigator.storage.persist()` is granted to installed web apps (Safari 17+) and persistent
  origins are skipped by WebKit's LRU eviction. Quota: up to 60% of disk.
- Web Push + badging for installed web apps since iOS 16.4; Declarative Web Push since 18.4.
- iOS 26 makes "open as web app" the *default* for Add to Home Screen.
- Residual risk is **bug-driven** IndexedDB loss (worst cluster: iOS 17.1–17.4) and
  icon-deletion (removes the data container) → mitigation: continuous cloud sync as source of
  truth, local DB treated as a cache, cheap full re-hydration.

Native alternatives all hit Apple's wall: $99/yr Developer Program, or free provisioning where
the app stops launching every 7 days (AltStore/SideStore ride the same certificates).

## Sync without a server

- **Google Drive from a browser SPA: ruled out.** Google Identity Services issues no refresh
  tokens to browser-only apps; token renewal is gesture-gated roughly hourly. (Official GIS docs.)
- **Dropbox**: PKCE + never-expiring refresh tokens; viable runner-up.
- **Firebase Firestore Spark**: viable; Google-platform risk (Storage was forced onto paid Oct 2025).
- **Supabase free**: auto-pauses after ~7 idle days — disqualified.
- **GitHub private repo + fine-grained PAT** *(chosen)*: PATs can be non-expiring (GA Mar 2025),
  api.github.com supports CORS, Contents API updates require the current file `sha` → real
  optimistic concurrency, and git history versions the data for free. Limits: 5,000 req/hr,
  100 MB/file — irrelevant at single-user scale.
  - Open item to verify early in implementation: browser CORS against api.github.com with PAT
    auth (marked "likely" in research, not exercised yet).

## Things 3 export

- The entire database is a plain SQLite file:
  `~/Library/Group Containers/JLMPQHK86H.com.culturedcode.ThingsMac/ThingsData-*/Things Database.thingsdatabase/main.sqlite`
- **things.py** (v1.0.1, actively maintained, Feb 2026) reads everything — projects, areas, tags,
  headings, checklists, dates, and the full Logbook with completion timestamps — **except
  repeating-task rules**, which it deliberately filters out (`rt1_recurrenceRule IS NULL`).
- Repeat rules live in an undocumented proprietary blob; no maintained decoder exists
  (things-cloud-sdk partially reverse-engineered the cloud-side format). Plan: best-effort decode
  + a post-import review screen.
- Things Cloud has **no public API**; official bulk export is literally "copy the SQLite file."
- On iOS, the same database is recoverable from a device backup (iTunes/Finder/Apple Devices),
  which is the route for importing a phone-only database.

## Framework

**Chosen: PWA** (Svelte + TypeScript + Vite). Rationale: zero distribution cost/friction, instant
updates, one codebase for iPhone/Android/Mac/PC, headless-browser testability (fast autonomous
iteration), and full CSS/canvas/WebGL capability for the juice. Flutter web renders into a canvas
(heavy on iOS, and its HTML renderer was removed); Expo/RN loses on distribution + test loop.
Escape hatch: the domain/sync/import logic is plain TypeScript and ports into Capacitor (or a
rebuild) if the prototype outgrows the web.

Haptics note: `navigator.vibrate` works on Android, not iOS Safari. The iOS 17.4+ `<input
type="switch">` system-haptic trick is an **unverified experiment** — try it during the juice
phase; degrade gracefully if dead.
