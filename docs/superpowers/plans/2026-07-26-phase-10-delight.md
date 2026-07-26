# Phase 10: Delight Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:executing-plans. NOTE: this plan
> deliberately documents the ENGINE only. Specific content lives exclusively in
> `src/lib/eggs/content/` and must never be described in docs, commit messages, task lists,
> or messages the user reads — discovery is the product (spec §12).

**Goal:** The surprise-and-delight layer: a rarity-tiered event engine that reacts to normal
app use with a large, growing pool of content moments, plus persistent discovery state
(trivia score, unlocks, streaks, a slow-burn narrative).

**Architecture:** `src/lib/eggs/engine.svelte.ts` — an event bus the app reports to
(`taskCompleted`, `drawAccepted`, `drawSkipped`, `screenVisited`, `appOpened`, `bigButtonPressed`).
Each registry entry: `{ id, weight, triggers, cooldownMs, maxPerDay, minCompletionsToday?,
condition?, present }`. A weighted roll (injected rng) picks at most ONE eligible entry per
event; per-egg `seen` counts + timestamps persist in kv `eggState` alongside trivia stats,
unlocks, streak, and story stage. Presenters are the only surfaces:

- `NoteToast` — small dismissable card, autodismiss ≤7s (the workhorse).
- `MomentOverlay` — full-screen visual beat, hard-capped ≤3.5s or tap-to-close, never blocks
  input longer than that (spec §12 hard rule), reduced-motion → skipped or static.
- `TriviaModal` — question + choices; records correct/total; always skippable.
- `UnlockBanner` + a "discoveries" panel in Settings showing `???` slots that fill in as found.
- Randomizer hook — a rare transient draw card under strict eligibility (nothing persisted
  unless the user explicitly accepts; accept materializes it as a real task = consent).
- Input-sequence listener for a couple of classic codes (keyboard on desktop, tap pattern on
  mobile), gated so accidental triggers are near-impossible.

**Hard rules enforced IN the engine, not per-egg:** never call store mutations (except the
consented accept path); overlay duration cap; one moment per event max; global frequency
governor (rolling window) so delight never becomes noise; everything honors
`prefers-reduced-motion`; all state device-local (kv), never synced… except trivia stats and
unlocks, which DO sync (they're earned progress).

**Testing:** engine unit tests with injected rng/clock — eligibility, cooldowns, per-day caps,
weighted selection, governor, trivia stat persistence, story-stage monotonicity, seen-tracking.
One e2e with a debug hook (`localStorage.OC_EGG_FORCE`) forcing a known-id content entry:
toast appears, dismisses, state records it. Content files themselves are data — validated by a
shape test (ids unique, weights sane, text lengths bounded), never by content-specific tests.

**Volume targets (first wave, then grow every session):** content pools sized for months of
daily use; a session-over-session content-expansion loop is the expected maintenance mode.

## Tasks
1. Engine + kv state + governor (TDD).
2. Presenters (toast/overlay/trivia/unlock/discoveries panel) + reduced-motion paths.
3. App hooks (completion, draw, screens, big button, sequences) + randomizer transient card.
4. Content wave 1 (large) + shape tests.
5. e2e (forced-id flow) + gate + generic commit messages throughout.
