# Phase 7: Things Import Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A built-in "Import from Things" flow: drop a `main.sqlite`, preview the mapping, import idempotently (including full Logbook history), review best-effort-decoded recurring tasks. Plus the extraction script for Ben's PC iPhone backup.

**Schema knowledge (verified against a real Things 3 DB, 2026-07-26 — NOT from docs):**
- Tables: `TMTask` (type: 0=to-do, 1=project, 2=heading via `type`; `status`: 0=open, 2=canceled, 3=completed; `trashed`; `start`: 0=Inbox, 1=Anytime/Today, 2=Someday; `area`/`project`/`heading` uuid refs), `TMArea`, `TMTag` (+`parent`), `TMTaskTag` (tasks/tags join), `TMChecklistItem` (`task` ref, `status`, `index`).
- Dates: `creationDate`/`userModificationDate`/`stopDate` are REAL **Cocoa seconds** (unix = v + 978307200); `startDate`/`deadline` are **bit-packed ints**: `(year<<16)|(month<<12)|(day<<7)`.
- Recurrence: `rt1_recurrenceRule` is an **XML plist** (not opaque!). Keys: `fu` frequency unit (old NSCalendarUnit: 4=year, 8=month, 16=day, 256=week), `fa` interval, `of` occurrence array (`{dy: n}` day-of-month observed; weekly entries expected `{wd: n}`, numbering unverified), `tp` type (hypothesis: 1=on-schedule, 0=after-completion — REVIEW SCREEN is the safety net for all decodes), `ia`/`sr` anchor dates, `rrv` version. Newer Things also has a `repeater` BLOB (unused in the inspected DB — detect and flag if present).
- Real personal data NEVER enters the repo: unit fixtures are built in-memory with sql.js.

**Mapping (spec §9):** projects & areas-with-loose-tasks → Lists (project's area title → `areaGroup`); headings → Tags (auto-color); TMTag → Tag; start 1+startDate≤today → High, start 0/1 → Medium, start 2 → Someday; deadline → deadline; checklist items → `- [ ]` lines appended to notes; status 3 → completedAt from stopDate; status 2 (canceled) → skipped; trashed → skipped; recurring templates (`rt1_recurrenceRule` on the template row) → RecurrenceTemplate + review flag; every imported entity carries `thingsUuid` for idempotent re-import.

## Tasks

1. **Deps + types**: `npm i sql.js` (+ wasm via `?url` import, lazy-loaded only on the import screen); add optional `thingsUuid` to `List`/`Tag`/`RecurrenceTemplate` (Task already has it).
2. **`src/lib/import/thingsRead.ts`** (sql.js → typed raw rows) + **`thingsMap.ts`** (pure rows → `{lists, tags, tasks, templates, review: string[]}` with all decoders above). TDD: date decoders, Cocoa conversion, priority mapping, heading→tag, checklist→markdown, logbook, recurrence plist decode incl. unknown-shape fallback (flag + afterCompletion 7d default), canceled/trashed skipping.
3. **Store `importThings(mapped)`**: upsert-by-thingsUuid across all four entity kinds (transactional via repo bulk helpers), preserving existing app ids on re-import; returns counts. TDD incl. re-import idempotency.
4. **ImportView** (`#/import`, entry from Settings): file picker → parse (spinner) → preview counts + mapping summary → import → recurrence review step (RecurrenceEditor per flagged template) → done screen. e2e (chromium): build a synthetic fixture DB with sql.js in the test, `setInputFiles`, import, assert tasks/lists/logbook/counts + re-import doesn't duplicate.
5. **`tools/extract-things-from-backup.py`** for Ben's PC (locate Things domain in an iTunes/Finder/Apple-Devices backup via Manifest.db, handle encrypted backups with getpass + the `iphone_backup_decrypt`-free manual AES path OR instruct pip install; emit `main.sqlite`) + `docs/BEN-IMPORT-SETUP.md`. Validation run of the full pipeline against the local WORK db copy via `tools/inspect-things.mjs` (manual, results not committed) to sanity-check mapping counts + all 9 real recurrence decodes.
6. Gate: check/unit/e2e green, CI, live verify, memory, tell Ben what's ready.

## Self-Review Notes

- Fidelity risks flagged into the review screen rather than silently guessed: recurrence `tp` semantics, weekly weekday numbering, yearly/daily-N cadences our model lacks (nearest-fit + flag).
- The importer never deletes existing app data; re-import updates by `thingsUuid` only.
