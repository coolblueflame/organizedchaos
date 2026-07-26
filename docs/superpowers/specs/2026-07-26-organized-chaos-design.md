# Organized Chaos — Design Spec

**Date:** 2026-07-26 · **Status:** Approved by Ben (verbal, this date) pending final read-through
**Repo:** `coolblueflame/organizedchaos` (public) · **App target:** installed PWA, iPhone-first

## 1. Vision

A minimalist, dark-IDE-themed, cross-platform todo app whose signature feature is the
**randomizer**: a big, prominent, upbeat button that draws one task from your highest-priority
available work and asks you to commit to it — **Accept** or **Not Today**. Deadlines
automatically escalate task priority so the draw stays honest. Inspiration: Things (structure,
calm), Notion (flexibility), and the Claude Code UltraCode selector (sheen/rainbow juice).

Why it exists: no app on the market implements deadline-escalated, priority-tiered random task
selection with a persistent current task (see `docs/research/2026-07-26-feasibility-research.md`).

## 2. Platform & architecture decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Delivery | PWA — Svelte 5 + TypeScript + Vite | Zero distribution friction (no $99/yr, no 7-day re-signing), instant updates, one codebase for iPhone/Android/Mac/PC, headless-browser testability. Installed PWAs are exempt from Safari's 7-day storage eviction (verified, WebKit docs). Escape hatch: domain logic is plain TS and ports to native later. |
| Hosting | GitHub Pages via Actions | Free, repo is public, no new accounts. |
| Local store | IndexedDB (Dexie), written on every mutation | Local-first; app must be fully usable offline. |
| Sync | Private repo `organizedchaos-data` via GitHub Contents API + fine-grained PAT | Never-expiring credential a browser can hold; `sha`-based optimistic concurrency; git history = free point-in-time recovery. The data repo is the **source of truth**; the local DB is a cache (iOS data-loss insurance). |
| Import | Built-in, generic "Import from Things" | Anyone drops a Things `main.sqlite`; parsed in-browser with sql.js (WASM). |

**Assumptions to verify at first contact** (fail → fallback noted):
1. `api.github.com` CORS + PAT auth works from a browser origin (research: "likely"). Fallback: Dropbox app-folder sync (researched runner-up).
2. sql.js opens current Things DBs. Fallback: a small Node CLI in this repo that converts `main.sqlite` → app-native JSON, which the app can import directly.
3. iOS `<input type="switch">` haptic trick works in iOS 26. Fallback: no haptics on iOS (Android keeps `navigator.vibrate`).

## 3. Data model

All entities: `id` (nanoid), `createdAt`, `updatedAt` (ms epoch), `deleted` (tombstone boolean —
kept for sync merge; tombstones older than 90 days are compacted away).

- **List** — `title`, `areaGroup?` (display grouping label on Home), `sortMode`
  (`priority | date | tag`, default `priority`, remembered per list).
- **Task** — `listId`, `name`, `notes` (markdown; imported Things checklists become `- [ ]`
  lines), `priority` (`someday | low | medium | high | max`, default `medium`),
  `tagIds[]`, `deadline?` (local date), `estimateHours?`, `inProgress` (bool),
  `notTodayUntil?` (timestamp), `completedAt?`, `recurrenceId?` (spawned-from link),
  `thingsUuid?` (import idempotency).
- **Tag** — `name`, `colorIndex` (0–15 preset palette).
- **RecurrenceTemplate** — snapshot fields (`name`, `notes`, `tagIds`, `priority`,
  `estimateHours`, `listId`) + `mode`:
  - `afterCompletion`: `{ interval, unit: days|weeks|months }` — completing the current instance
    schedules `nextSpawnAt = completion + interval`; the task *comes back* then, not instantly.
  - `schedule`: `{ weekly: [weekdays] }` or `{ monthly: dayOfMonth }` — spawns at 4am on due days.
  - `nextSpawnAt?` — when the next instance materializes; a spawn sweep runs at app
    open/focus and at 4am rollover and creates tasks whose `nextSpawnAt` has arrived.
  - `deadlineOffsetDays?` — spawned task gets `deadline = spawnDate + offset`; when unset,
    spawned task carries the template's priority (and no deadline).
  - `paused` (bool), `lastSpawnedTaskId?`.
- **CurrentTask** — `{ taskId, acceptedAt }` singleton; persisted so an app kill never loses it.
- **Settings** — `hoursPerDay` (default 1), `slackBandDays` (default 3), `rolloverHour`
  (default 4), sync config (data repo `owner/name`; PAT stored device-local only, **never synced**).

**The 4am rule:** a "day" flips at `rolloverHour` local time everywhere it matters — `notTodayUntil`
expiry, scheduled recurrence spawning, and stats day-bucketing (finish a task at 2am, it counts
for the evening before).

## 4. Priority & the randomizer

**Effective priority** = `max(manualPriority, derivedPriority)` — deadlines only ever escalate.
Derived (only when a deadline exists):

```
slack = daysUntil(deadline) − ceil((estimateHours ?? 1) / hoursPerDay)
slack ≤ 0            → max
slack ≤ slackBand    → high        (default band = 3 days)
slack ≤ slackBand×2  → medium
otherwise            → low         (floor for any deadlined task)
```

Ben's calibration example (2h estimate, 1h/day): ≤2 days out = Max, 3 = High, 6 = Medium,
9 = Low. ✔ Escalated tasks show a visual indicator (e.g. small flame + the escalated tier color)
so it's obvious why something jumped the queue.

**Draw algorithm** (global from Home, or scoped to one list from a list view; the randomizer
screen also offers **filters** — restrict the pool to chosen list(s) and/or tag(s); a task
matches a tag filter if it carries any selected tag):
1. Eligible: not completed, not deleted, `notTodayUntil` absent/expired, not in the session's
   "Not Now" exclusion set; scoped by the active list/tag filters. *`notTodayUntil` affects ONLY
   randomizer eligibility — snoozed tasks remain fully visible in lists, sort views, and In
   Progress.*
2. Group by effective priority; take the highest non-empty tier. **Someday is the bottom tier**
   — it participates, but only when every tier above is empty.
3. Within the tier: if any tasks are `inProgress`, draw uniformly among those; else uniformly
   among the tier.
4. Present with three choices:
   - **Accept** → becomes CurrentTask, `inProgress = true`.
   - **Not Now** → transient skip: the task joins a session-only exclusion set and a new task is
     drawn immediately (guaranteed different). The set lives only while the randomizer screen is
     open — closing it (or exhausting the pool) resets; nothing is persisted.
   - **Not Today** → `notTodayUntil = next 4am`; nothing else changes.
   Dismissing the draw without choosing leaves the task untouched.

**Current task rules:** exactly one at a time. Accepting while one is active returns the old one
to the general pool (stays `inProgress`, not snoozed). From the Home card you can: complete it
(celebration!), edit it (notably the estimate), send it to Not Today (clears CurrentTask, sets
snooze, keeps `inProgress`), or clear it. Any task row/editor offers **"Make current"** to bypass
the randomizer.

## 5. Recurrence behavior

- `afterCompletion` templates schedule the next instance for `completion + interval`; the spawn
  sweep materializes it when that moment passes (so "3 days after done" means 3 days of quiet).
- `schedule` templates spawn at 4am on scheduled days — **skipped if the previously spawned
  instance is still open** (no pileup of "water the plants"). [Default — Ben may veto.]
- Completing a task that has a `recurrenceId` is what feeds `afterCompletion`; deleting a
  spawned task does not delete its template.
- Home → **Recurring** screen lists all templates with next-fire info, edit, pause, delete.
- Editing a template affects future spawns only.

## 6. Screens

**Home** — top to bottom:
1. **Stats strip**: animated counters — today / this week / this month / this year / lifetime
   completed. Tapping opens the **progress graph** (completions over time; day/week/month
   granularity toggles).
2. **The Big Button** — full-width, prominent; label rotates through a large pool (~60+) of
   upbeat/funny phrases ("Let's gooooo!", "BEAST MODE", "Roll the dice.", "Git 'er done!",
   "Summon my destiny", …). Same action always: global randomizer.
3. **Current Task card** (when set): name, list, tags, deadline/estimate; complete / edit /
   not-today controls.
4. **Sort views row**: `Sort by Date` · `Sort by Priority` · `Sort by Tag` (global, all lists).
5. **Lists**, grouped under their `areaGroup` headers, + New List.
6. **In Progress** · **Recurring** · **Completed** entries.

**Sort views** (all: checkbox-complete and delete on every row; rows show list name):
- *Date*: sections per deadline date (Overdue first, then dates ascending), sub-sorted by
  effective priority; "No deadline" section at the bottom.
- *Priority*: sections Max → Someday by effective priority, sub-sorted by deadline (soonest
  first, deadline-less last).
- *Tag*: alphabetical tag sections; multi-tag tasks appear in each of their tags' sections;
  "Untagged" section at the bottom; sub-sorted by effective priority.

**List view** — header with title + list-scoped randomizer button; sort toggle (remembers per
list); tasks as rows (checkbox, name, tag chips, deadline/priority glyphs); **New Todo** →
inserts immediately, scrolls into view, expands the editor with the name field focused.
Delete via swipe (touch) / hover action (desktop) with a brief undo toast. Lists themselves can
be renamed, re-grouped (`areaGroup`), and deleted — deleting a list requires a confirm and
tombstones its open tasks with it (its completed tasks stay in the logbook/stats).

**Task editor** (expanding row, not a separate page): unlabeled name (top) and notes (below,
freeform markdown) → priority segmented control → tag picker (existing tags + create-new with
16-color swatch) → deadline (date picker) → estimate (hours) → recurrence editor. Shows
created/completed dates. Delete + Make-current live here too.

**Completed** — endless list grouped by completion date (4am-bucketed), newest first, with
un-complete (restore) on each row.

**Import** — drop/browse for `main.sqlite` → parse → mapping preview (lists/areas found, heading→
tag conversions, task counts incl. Logbook) → confirm → repeating-tasks review step (best-effort
decoded rules shown for confirm/fix/skip). Re-import with the same file is idempotent
(`thingsUuid` upsert).

**Settings** — sync setup (data repo + PAT paste, sync-now, last-synced, log), JSON export
(full backup download), import entry, tuning knobs (`hoursPerDay`, `slackBandDays`,
`rolloverHour`), about.

## 7. Aesthetic & juice

- **Theme**: dark-only v1. Near-black layered greys (#0d1117-ish family), soft-contrast text;
  accent palette drawn from dark-mode syntax highlighting — blue, purple, green, orange, cyan,
  magenta, yellow. Monospace-flavored type for numbers/counters; clean sans for body.
  16-color tag swatch chosen for distinguishability on dark.
- **Juice moments** (canvas particle layer + CSS): randomizer roll = slot-machine-style text
  shuffle → reveal with rainbow sheen sweep (the UltraCode effect) + particle burst; task
  complete = checkbox morph, row dissolve, small confetti, counter tick-up; current-task
  accept = button pulse + rainbow border sweep; big-button hover/press = sheen + spring scale.
  Idle rainbow shimmer occasionally crosses the big button.
- **Haptics**: Android `navigator.vibrate` on complete/accept; iOS switch-trick experiment.
- Respect `prefers-reduced-motion`: swap particles/shuffles for gentle fades.

## 8. Sync protocol (GitHub data repo)

- Files in `organizedchaos-data`: `active.json` (lists, live tasks, tags, templates, current
  task), `logbook-<year>.json` (completed tasks, append-mostly), `meta.json` (schema version).
- Completed tasks move from `active.json` to the current year's logbook file at write time —
  keeps the frequently-pushed file small (hundreds of KB, not MB).
- Cycle (debounced ~4s after a mutation, plus on launch/focus/manual): GET file (ETag-cached) →
  entity-level merge (newest `updatedAt` wins; tombstones beat updates at equal times) → PUT with
  known `sha` → on 409/412 conflict, re-GET, re-merge, retry (bounded).
- PAT scope: contents read/write on the data repo ONLY. Stored in IndexedDB on-device; never in
  the code repo, never in synced files.
- Sync status surfaced quietly (dot on Settings; toast only on hard failures like a revoked PAT).
- First-run on a new device: paste PAT → full pull → hydrated. Deleting the home-screen icon
  therefore costs nothing but a re-install + paste.

## 9. Things import mapping

| Things | Organized Chaos |
|---|---|
| Project / Area (with loose tasks) | List (project's area name → `areaGroup`) |
| Heading | Tag (auto-assigned to its tasks; colors auto-cycled) |
| Tag | Tag |
| Today / Anytime / Someday | priority High / Medium / Someday |
| Deadline | `deadline` |
| Checklist items | `- [ ]` markdown lines in notes |
| Notes | notes (prepended above checklist) |
| Logbook item (+ completion date) | completed task with `completedAt` (→ stats are real from day one) |
| Repeating rule (`rt1_recurrenceRule` blob) | best-effort decode → RecurrenceTemplate, flagged for the review step |
| Trash | skipped |

Ben's personal data path: iPhone backup on his PC → provided extraction script (locates the
Things domain via the backup's `Manifest.db`, handles encrypted backups with password) →
`main.sqlite` → drop into the app. The work database on this Mac is **test data only** and must
never be imported for real.

## 10. Testing

- **Domain (Vitest, exhaustive)**: priority derivation (band edges, missing estimate, past
  deadlines), draw algorithm (tier selection, in-progress preference, snooze expiry, list
  scoping, distribution sanity), recurrence spawning (both modes, 4am boundary, skip-if-open,
  month-end dates), merge (concurrent edits, tombstones, clock skew), stats bucketing (4am rule),
  import mapping (fixtures cut from the work DB, anonymized).
- **E2E (Playwright)**: create/complete/delete flows, randomizer accept/not-today, current-task
  persistence across reload, offline mutation → later sync, sync conflict resolution against a
  stubbed API, import happy-path with a fixture sqlite.
- **Visual**: screenshot checkpoints per juice iteration (Ben reviews on-device and gives notes).

## 11. Build phases (each ends deployed + a pushed commit)

1. **Scaffold + domain core** — repo tooling, CI deploy to Pages, entities + priority/draw/
   recurrence logic fully unit-tested, IndexedDB persistence.
2. **Lists & views** — Home skeleton, list CRUD, task CRUD + editor, checkbox/delete everywhere,
   three sort views, per-list sort memory.
3. **Randomizer + current task** — the big button, draw flow, accept/not-today, In Progress view.
4. **Recurrence** — templates, both modes, Recurring screen.
5. **Juice pass** — theme polish, particles, sheens, animations, haptics experiment, button
   phrase pool.
6. **Sync** — CORS spike first; protocol, settings UX, multi-device test.
7. **Things import** — sql.js spike vs work-DB copy; importer UI + recurrence review; PC backup
   extraction script for Ben.
8. **Stats & graph** — counters, graph view.
9. **PWA polish** — manifest/icons/splash, offline audit, `persist()` prompt, install
   instructions, JSON export.

Phases 2–5 are where Ben's iterative visual feedback rounds are expected; later phases have
sharper acceptance criteria.

## 12. Out of scope (v1)

Push notifications/reminders (needs a send server — revisit with ntfy/Worker later) · light
theme · multi-user/sharing · widgets · native rebuild · ongoing Things sync (import is one-way,
repeatable) · attachments.
