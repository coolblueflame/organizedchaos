# Phase 5: Juice Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The app feels alive: particle bursts on completion/accept, rainbow sheen sweeps (the UltraCode effect), a slot-machine draw reveal, springy micro-interactions, haptics where the platform allows — all honoring `prefers-reduced-motion`.

**Architecture:** One fixed full-screen canvas (`FxLayer`) hosts all particles via a tiny zero-dep engine (`fx/particles.ts`); components request bursts at DOM coordinates. Sheens are pure CSS (pseudo-element gradient sweeps). The slot-machine reveal is a text-shuffle helper consumed by RandomizerView. Haptics live behind one `fx/haptics.ts` facade (Android `navigator.vibrate`; iOS 17.4+ hidden-switch experiment — spec §2 assumption 3).

**Spec:** §7. This phase is Ben-iterative by design: land a tasteful first pass, deploy, capture screenshots for his review, expect small concrete notes ("2px down", "touch lighter") in later rounds.

## Global Constraints

- Zero new dependencies; the particle engine is hand-rolled (a game dev is the client — it should be decent: velocity, gravity, drag, spin, fade).
- Reduced motion: `matchMedia('(prefers-reduced-motion: reduce)')` disables particles + shuffles + idle shimmer entirely (CSS via media query, JS via the shared `motionOk()` check); functional flows must behave identically.
- Animation must never gate correctness: completion delay ≤ 400ms, and all existing e2e must stay green unmodified (they poll, so they tolerate it).
- All juice colors come from the accent palette (`tagColors.ts` / CSS vars) — no new colors.

---

### Task 1: Particle engine + FxLayer

**Files:** create `src/lib/ui/fx/particles.ts`, `src/lib/ui/fx/FxLayer.svelte`; modify `src/App.svelte` (mount FxLayer last).

```ts
// particles.ts — public surface
export function motionOk(): boolean;                       // false under prefers-reduced-motion
export function burstAt(x: number, y: number, opts?: { count?: number; colors?: string[]; power?: number }): void;
export function confettiAt(x: number, y: number): void;    // bigger, celebratory preset
export function burstFromElement(el: Element, opts?: …): void; // center-of-rect convenience
export function bindCanvas(canvas: HTMLCanvasElement): () => void; // FxLayer wires this; returns unbind
```

Engine: particle pool (~300 cap), each `{x,y,vx,vy,life,decay,size,color,spin,shape:'square'|'dot'}`; integration with gravity + drag; RAF loop that starts on first spawn and stops when the pool empties (no idle RAF); devicePixelRatio-aware canvas sizing on resize. Unit test the pure step function (`stepParticle`) for gravity/decay math; everything else is visual.

- [ ] Implement + minimal unit test; check; commit `feat: particle engine + fx layer`

---

### Task 2: Haptics facade

**Files:** create `src/lib/ui/fx/haptics.ts`; FxLayer hosts the hidden iOS switch.

```ts
export function haptic(kind: 'tick' | 'success' | 'heavy'): void;
export function bindIosSwitch(el: HTMLInputElement): void; // FxLayer provides the hidden <input type="checkbox" switch>
```

Android/Chromium: `navigator.vibrate(tick=8 | success=[10,40,14] | heavy=25)`. iOS Safari: no vibrate API — EXPERIMENT (spec §2 assumption 3): a hidden `<input type="checkbox" switch>` toggled inside the user-gesture call stack sometimes fires the system switch haptic on iOS 17.4+. Toggle it in `haptic()` when the platform is iOS; harmless no-op if dead. Document the verdict in code comments after Ben tries it on-device (cannot be verified from here).

- [ ] Implement; check; commit `feat: haptics facade with iOS switch experiment`

---

### Task 3: Wire the moments

**Files:** modify `TaskRow.svelte`, `RandomizerView.svelte`, `CurrentTaskCard.svelte`, `Home.svelte`, `app.css`.

- **Complete (any TaskRow)**: checkbox fills green + inline SVG check draws (~200ms), `burstFromElement(checkbox, {colors: greens/cyans})`, `haptic('success')`, then `completeTask()`; row exits with `transition:slide` (~250ms). Same for `current-complete` but `confettiAt` (bigger).
- **Draw reveal (RandomizerView)**: on every (re)draw, the task name slot-machines — cycles ~8 scrambled/other-name frames over ~450ms before settling (helper `shuffleReveal(finalText, cb)` in `fx/shuffle.ts`, unit-testable timing-free by injecting the tick fn) — plus a rainbow sheen sweep across the card on settle.
- **Accept**: rainbow border sweep on the card + `burstFromElement(accept button)` + `haptic('heavy')`, ~350ms, then navigate home.
- **Big button**: CSS idle shimmer (a sheen crosses every ~7s), `:active` spring scale, hover glow (already partial); pressing it fires `haptic('tick')`.
- **Sheen utility**: `.sheen` class in app.css — `::after` translating gradient (transparent → white/rainbow → transparent), `@media (prefers-reduced-motion: reduce)` kills it.

- [ ] Implement; ALL existing e2e green unmodified; check; commit `feat: juice — particles, sheens, slot-machine reveal, haptics`

---

### Task 4: Reduced-motion e2e + screenshots + gate

**Files:** create `e2e/juice.spec.ts` (2 tests): (a) `page.emulateMedia({ reducedMotion: 'reduce' })` → complete-a-task flow still works and the row disappears promptly; (b) normal motion → completing still lands the task in Completed (animation doesn't eat the mutation). Then a screenshot capture run (not committed as test): home, list-with-tasks, randomizer draw → PNGs sent to Ben for the visual iteration rounds.

- [ ] e2e green both engines; unit + check green; commit `test: reduced-motion coverage`; push; CI green; live verify; screenshots to Ben; memory update.

## Self-Review Notes

- §7 coverage: particles ✔ (complete/accept/confetti), rainbow sheen ✔ (card settle + big-button idle), slot-machine ✔, spring micro-interactions ✔, haptics ✔ (Android real, iOS experiment flagged), reduced-motion ✔. Deferred: stats count-up (Phase 8, where counters exist).
- Correctness guard: mutation always runs even if animation code throws (try/finally around the delay).
