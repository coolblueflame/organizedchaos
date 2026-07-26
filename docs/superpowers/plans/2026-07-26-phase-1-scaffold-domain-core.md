# Phase 1: Scaffold + Domain Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A deployed (GitHub Pages) Svelte PWA shell with the entire Organized Chaos domain core — priority escalation, randomizer draw, recurrence engine, 4am day math — implemented as pure, exhaustively unit-tested TypeScript, plus IndexedDB persistence.

**Architecture:** Three layers, strictly separated: `src/lib/domain/` (pure TS, zero framework/browser imports — all logic testable in Node), `src/lib/storage/` (Dexie/IndexedDB persistence with `updatedAt` stamping for future sync), `src/` UI shell (Svelte 5; real screens come in Phase 2). CI runs unit + e2e tests, then deploys to GitHub Pages on every push to main.

**Tech Stack:** Svelte 5 + TypeScript (strict) + Vite · Vitest · Playwright · Dexie 4 · nanoid · fake-indexeddb (tests) · GitHub Actions → Pages.

**Spec:** `docs/superpowers/specs/2026-07-26-organized-chaos-design.md` (authoritative; this plan implements spec §§3–5 domain logic, §2 hosting, §7 theme tokens only).

## Global Constraints

- TypeScript `strict: true`; domain files must not import from svelte, dexie, or any browser API.
- All timestamps are ms-epoch `number`s; all calendar dates are local `'YYYY-MM-DD'` strings.
- Priorities: `'someday' | 'low' | 'medium' | 'high' | 'max'` — exactly these literals, this order.
- The "app day" boundary is `settings.rolloverHour` (default 4) local time, used everywhere.
- Defaults (spec §3): `hoursPerDay: 1`, `slackBandDays: 3`, `rolloverHour: 4`; missing estimate = 1h.
- Repo is PUBLIC: no secrets, no personal data, no real Things data in fixtures — ever.
- Vite `base` is `'/organizedchaos/'` (Pages project site).
- Commits: small, imperative subject, direct to main, each ending with the Claude trailer lines used by this session (write message to a temp file, `git commit -F`).
- Bash style: flat single-purpose commands, `git -C <path>`, no `cd`/`$(...)`/loops.
- Dependency versions: install latest at execution time (`npm install <pkg>` without pins); carets in package.json are floors, not locks. If a listed API doesn't match the installed major, check the package's changelog and adapt the call site, not the version.

---

### Task 1: Project scaffold + toolchain

**Files:**
- Create: `package.json`, `vite.config.ts`, `tsconfig.json`, `svelte.config.js`, `index.html`, `.gitignore`, `src/main.ts`, `src/App.svelte`, `src/app.css`, `src/vite-env.d.ts`, `src/tests/setup.ts`

**Interfaces:**
- Consumes: nothing (first task).
- Produces: working `npm run dev/build/check/test`; `__APP_VERSION__` global; CSS variable theme tokens (`--bg0/1/2`, `--text`, `--dim`, `--acc-blue/purple/green/orange/cyan/magenta/yellow`, `--font-mono`, `--font-sans`) that ALL later UI work must use — no hardcoded colors outside `app.css`.

- [ ] **Step 1: Write config + shell files**

`package.json` (versions are floors — run the npm installs in Step 2 rather than copying versions):

```json
{
  "name": "organizedchaos",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview",
    "check": "svelte-check --tsconfig ./tsconfig.json",
    "test": "vitest run",
    "test:watch": "vitest",
    "e2e": "playwright test"
  }
}
```

`vite.config.ts`:

```ts
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import pkg from './package.json' with { type: 'json' };

export default defineConfig({
  base: '/organizedchaos/',
  plugins: [svelte()],
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  test: {
    include: ['src/**/*.test.ts'],
    environment: 'node',
    setupFiles: ['src/tests/setup.ts'],
  },
});
```

(If the installed vitest major wants `/// <reference types="vitest/config" />` or `defineConfig` from `vitest/config` for the `test` key, use that form.)

`tsconfig.json`:

```json
{
  "extends": "@tsconfig/svelte/tsconfig.json",
  "compilerOptions": {
    "strict": true,
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["vite/client"],
    "noUncheckedIndexedAccess": true
  },
  "include": ["src/**/*.ts", "src/**/*.svelte", "vite.config.ts"]
}
```

`svelte.config.js`:

```js
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
export default { preprocess: vitePreprocess() };
```

`index.html`:

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0, viewport-fit=cover" />
    <meta name="theme-color" content="#0b0e14" />
    <title>Organized Chaos</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/app.css` (the theme tokens — dark IDE palette, spec §7):

```css
:root {
  --bg0: #0b0e14;   /* app background */
  --bg1: #11151c;   /* cards / list rows */
  --bg2: #1a2029;   /* raised elements, inputs */
  --line: #232a35;  /* hairline borders */
  --text: #c9d1d9;
  --dim: #8b949e;
  --acc-blue: #79c0ff;
  --acc-purple: #d2a8ff;
  --acc-green: #7ee787;
  --acc-orange: #ffa657;
  --acc-cyan: #56d4dd;
  --acc-magenta: #f778ba;
  --acc-yellow: #e3b341;
  --font-mono: ui-monospace, "SF Mono", "JetBrains Mono", Menlo, monospace;
  --font-sans: -apple-system, system-ui, "Segoe UI", Roboto, sans-serif;
}
* { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
body {
  background: var(--bg0);
  color: var(--text);
  font-family: var(--font-sans);
  -webkit-font-smoothing: antialiased;
}
```

`src/main.ts`:

```ts
import './app.css';
import { mount } from 'svelte';
import App from './App.svelte';

const app = mount(App, { target: document.getElementById('app')! });
export default app;
```

`src/App.svelte` (placeholder shell — replaced in Phase 2; proves theme + build):

```svelte
<main>
  <h1 class="wordmark">organized<span class="accent">chaos</span><span class="cursor">▊</span></h1>
  <p class="tagline">// a todo list with a gambling problem</p>
  <div class="swatches">
    {#each ['--acc-blue', '--acc-purple', '--acc-green', '--acc-orange', '--acc-cyan', '--acc-magenta', '--acc-yellow'] as c}
      <span class="dot" style="background: var({c})"></span>
    {/each}
  </div>
  <p class="version">v{__APP_VERSION__}</p>
</main>

<style>
  main { min-height: 100vh; display: grid; place-content: center; text-align: center; gap: 12px; }
  .wordmark { font-family: var(--font-mono); font-size: 2rem; margin: 0; font-weight: 600; }
  .accent { color: var(--acc-purple); }
  .cursor { color: var(--acc-green); animation: blink 1.1s steps(1) infinite; }
  @keyframes blink { 50% { opacity: 0; } }
  .tagline { color: var(--dim); font-family: var(--font-mono); font-size: 0.9rem; margin: 0; }
  .swatches { display: flex; gap: 8px; justify-content: center; }
  .dot { width: 10px; height: 10px; border-radius: 50%; }
  .version { color: var(--dim); font-family: var(--font-mono); font-size: 0.75rem; }
</style>
```

`src/vite-env.d.ts`:

```ts
/// <reference types="svelte" />
/// <reference types="vite/client" />
declare const __APP_VERSION__: string;
```

`src/tests/setup.ts`:

```ts
import 'fake-indexeddb/auto';
```

`.gitignore`:

```
node_modules/
dist/
test-results/
playwright-report/
.DS_Store
```

- [ ] **Step 2: Install dependencies**

Run: `npm install svelte dexie nanoid`
Run: `npm install -D vite @sveltejs/vite-plugin-svelte typescript svelte-check @tsconfig/svelte vitest fake-indexeddb @playwright/test`

- [ ] **Step 3: Verify toolchain**

Run: `npm run check` — Expected: 0 errors.
Run: `npm run build` — Expected: `dist/` produced without errors.
Run: `npx vitest run --passWithNoTests` — Expected: passes (no tests yet).

- [ ] **Step 4: Commit**

`git -C . add -A` then commit: `feat: scaffold Svelte+Vite+TS project with dark IDE theme tokens`

---

### Task 2: Domain types

**Files:**
- Create: `src/lib/domain/types.ts`
- Test: `src/lib/domain/types.test.ts`

**Interfaces:**
- Produces (used by every later task):

```ts
export type Priority = 'someday' | 'low' | 'medium' | 'high' | 'max';
export const PRIORITIES: readonly Priority[];         // ascending: someday → max
export function priorityRank(p: Priority): number;    // someday=0 … max=4
export type SortMode = 'priority' | 'date' | 'tag';

interface Base { id: string; createdAt: number; updatedAt: number; deleted: boolean }
export interface List extends Base { title: string; areaGroup?: string; sortMode: SortMode }
export interface Task extends Base {
  listId: string; name: string; notes: string; priority: Priority; tagIds: string[];
  deadline?: string; estimateHours?: number; inProgress: boolean;
  notTodayUntil?: number; completedAt?: number; recurrenceId?: string; thingsUuid?: string;
}
export interface Tag extends Base { name: string; colorIndex: number }
export type RecurrenceMode =
  | { kind: 'afterCompletion'; interval: number; unit: 'days' | 'weeks' | 'months' }
  | { kind: 'weekly'; weekdays: number[] }        // 0=Sunday … 6=Saturday (JS getDay)
  | { kind: 'monthly'; dayOfMonth: number };      // 1–31, clamped to month length
export interface RecurrenceTemplate extends Base {
  listId: string; name: string; notes: string; tagIds: string[]; priority: Priority;
  estimateHours?: number; mode: RecurrenceMode; deadlineOffsetDays?: number;
  paused: boolean; nextSpawnAt?: number; lastSpawnedTaskId?: string;
}
export interface CurrentTaskRef { taskId: string; acceptedAt: number }
export interface Settings { hoursPerDay: number; slackBandDays: number; rolloverHour: number }
export const DEFAULT_SETTINGS: Settings;              // { 1, 3, 4 }
export type TaskDraft = Omit<Task, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/types.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, PRIORITIES, priorityRank } from './types';

describe('priority ordering', () => {
  it('ranks someday lowest and max highest', () => {
    expect(priorityRank('someday')).toBe(0);
    expect(priorityRank('max')).toBe(4);
    expect(priorityRank('high')).toBeGreaterThan(priorityRank('medium'));
    expect(priorityRank('medium')).toBeGreaterThan(priorityRank('low'));
    expect(priorityRank('low')).toBeGreaterThan(priorityRank('someday'));
  });
  it('PRIORITIES is ascending and complete', () => {
    expect(PRIORITIES).toEqual(['someday', 'low', 'medium', 'high', 'max']);
  });
});

describe('defaults', () => {
  it('matches spec §3', () => {
    expect(DEFAULT_SETTINGS).toEqual({ hoursPerDay: 1, slackBandDays: 3, rolloverHour: 4 });
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/domain/types.test.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** — write `types.ts` exactly as the Interfaces block above, with:

```ts
export const PRIORITIES = ['someday', 'low', 'medium', 'high', 'max'] as const satisfies readonly Priority[];
export function priorityRank(p: Priority): number { return PRIORITIES.indexOf(p); }
export const DEFAULT_SETTINGS: Settings = { hoursPerDay: 1, slackBandDays: 3, rolloverHour: 4 };
```

- [ ] **Step 4: Run to verify pass** — same command → PASS.
- [ ] **Step 5: Commit** — `feat: add domain types, priority ordering, default settings`

---

### Task 3: App-day time math (the 4am rule)

**Files:**
- Create: `src/lib/domain/time.ts`
- Test: `src/lib/domain/time.test.ts`

**Interfaces:**
- Consumes: `Settings['rolloverHour']`.
- Produces:

```ts
export function appDayKey(now: Date, rolloverHour: number): string;        // 'YYYY-MM-DD' of the app-day containing `now`
export function nextRollover(now: Date, rolloverHour: number): Date;       // strictly-future next boundary
export function nextRolloverTs(nowTs: number, rolloverHour: number): number;
export function daysUntilDeadline(deadline: string, now: Date, rolloverHour: number): number;
  // whole app-days from now's app-day to the deadline date: today→0, tomorrow→1, yesterday→-1
export function dateKey(d: Date): string;                                  // local 'YYYY-MM-DD'
export function addDaysKey(key: string, days: number): string;             // calendar-day arithmetic on keys
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/time.test.ts
import { describe, expect, it } from 'vitest';
import { addDaysKey, appDayKey, daysUntilDeadline, nextRollover } from './time';

const at = (s: string) => new Date(s); // local-time ISO without zone suffix

describe('appDayKey (4am rollover)', () => {
  it('2am belongs to the previous day', () => {
    expect(appDayKey(at('2026-07-15T02:00:00'), 4)).toBe('2026-07-14');
  });
  it('4am starts the new day; 3:59 does not', () => {
    expect(appDayKey(at('2026-07-15T04:00:00'), 4)).toBe('2026-07-15');
    expect(appDayKey(at('2026-07-15T03:59:59'), 4)).toBe('2026-07-14');
  });
  it('noon is plainly today', () => {
    expect(appDayKey(at('2026-07-15T12:00:00'), 4)).toBe('2026-07-15');
  });
  it('month boundary: 1st at 1am is still last month', () => {
    expect(appDayKey(at('2026-08-01T01:00:00'), 4)).toBe('2026-07-31');
  });
});

describe('nextRollover', () => {
  it('before 4am → 4am today', () => {
    expect(nextRollover(at('2026-07-15T02:00:00'), 4).getTime())
      .toBe(at('2026-07-15T04:00:00').getTime());
  });
  it('after 4am → 4am tomorrow', () => {
    expect(nextRollover(at('2026-07-15T10:00:00'), 4).getTime())
      .toBe(at('2026-07-16T04:00:00').getTime());
  });
  it('exactly 4am → 4am tomorrow (strictly future)', () => {
    expect(nextRollover(at('2026-07-15T04:00:00'), 4).getTime())
      .toBe(at('2026-07-16T04:00:00').getTime());
  });
});

describe('daysUntilDeadline', () => {
  it('deadline today → 0', () => {
    expect(daysUntilDeadline('2026-07-15', at('2026-07-15T12:00:00'), 4)).toBe(0);
  });
  it('2am still counts as yesterday, so a deadline of "yesterday" is 0 not -1', () => {
    expect(daysUntilDeadline('2026-07-15', at('2026-07-16T02:00:00'), 4)).toBe(0);
  });
  it('future and past', () => {
    expect(daysUntilDeadline('2026-07-18', at('2026-07-15T12:00:00'), 4)).toBe(3);
    expect(daysUntilDeadline('2026-07-14', at('2026-07-15T12:00:00'), 4)).toBe(-1);
  });
});

describe('addDaysKey', () => {
  it('crosses month ends', () => {
    expect(addDaysKey('2026-07-30', 3)).toBe('2026-08-02');
    expect(addDaysKey('2026-03-01', -1)).toBe('2026-02-28');
  });
});
```

- [ ] **Step 2: Run to verify fail** — `npx vitest run src/lib/domain/time.test.ts` → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/time.ts
/** All "day" logic uses LOCAL time and the app-day boundary at `rolloverHour` (spec §3). */

export function dateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** The calendar date of the app-day containing `now` (2am belongs to yesterday). */
export function appDayKey(now: Date, rolloverHour: number): string {
  const shifted = new Date(now.getTime());
  shifted.setHours(shifted.getHours() - rolloverHour);
  return dateKey(shifted);
}

export function nextRollover(now: Date, rolloverHour: number): Date {
  const candidate = new Date(now.getFullYear(), now.getMonth(), now.getDate(), rolloverHour);
  if (candidate.getTime() <= now.getTime()) candidate.setDate(candidate.getDate() + 1);
  return candidate;
}

export function nextRolloverTs(nowTs: number, rolloverHour: number): number {
  return nextRollover(new Date(nowTs), rolloverHour).getTime();
}

function keyToDate(key: string): Date {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(y!, m! - 1, d!, 12); // noon avoids DST edge drift in day arithmetic
}

export function addDaysKey(key: string, days: number): string {
  const d = keyToDate(key);
  d.setDate(d.getDate() + days);
  return dateKey(d);
}

/** Whole app-days between now's app-day and the deadline date (today→0, past→negative). */
export function daysUntilDeadline(deadline: string, now: Date, rolloverHour: number): number {
  const nowDay = keyToDate(appDayKey(now, rolloverHour));
  const dueDay = keyToDate(deadline);
  return Math.round((dueDay.getTime() - nowDay.getTime()) / 86_400_000);
}
```

- [ ] **Step 4: Run to verify pass** — same command → PASS.
- [ ] **Step 5: Commit** — `feat: add app-day time math (4am rollover rule)`

---

### Task 4: Priority derivation

**Files:**
- Create: `src/lib/domain/priority.ts`
- Test: `src/lib/domain/priority.test.ts`

**Interfaces:**
- Consumes: `Task`, `Settings`, `Priority`, `priorityRank`, `PRIORITIES` (Task 2); `daysUntilDeadline` (Task 3).
- Produces:

```ts
export function derivedPriority(task: Pick<Task, 'deadline' | 'estimateHours'>, settings: Settings, now: Date): Priority | null;
export function effectivePriority(task: Pick<Task, 'deadline' | 'estimateHours' | 'priority'>, settings: Settings, now: Date): Priority;
export function isEscalated(task: Pick<Task, 'deadline' | 'estimateHours' | 'priority'>, settings: Settings, now: Date): boolean;
```

- [ ] **Step 1: Write the failing test** (the spec §4 calibration table is law)

```ts
// src/lib/domain/priority.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS } from './types';
import { derivedPriority, effectivePriority, isEscalated } from './priority';

const now = new Date('2026-07-15T12:00:00');
const dl = (daysAway: number) => {
  const d = new Date(now);
  d.setDate(d.getDate() + daysAway);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

describe('derivedPriority — spec §4 calibration (2h estimate, 1h/day)', () => {
  const cases: Array<[number, string]> = [
    [0, 'max'], [1, 'max'], [2, 'max'],   // slack ≤ 0
    [3, 'high'], [5, 'high'],             // slack 1–3
    [6, 'medium'], [8, 'medium'],         // slack 4–6
    [9, 'low'], [30, 'low'],              // slack ≥ 7 → floor
  ];
  for (const [days, expected] of cases) {
    it(`deadline in ${days} days → ${expected}`, () => {
      expect(derivedPriority({ deadline: dl(days), estimateHours: 2 }, DEFAULT_SETTINGS, now)).toBe(expected);
    });
  }
  it('overdue → max', () => {
    expect(derivedPriority({ deadline: dl(-3), estimateHours: 2 }, DEFAULT_SETTINGS, now)).toBe('max');
  });
  it('no deadline → null', () => {
    expect(derivedPriority({ deadline: undefined }, DEFAULT_SETTINGS, now)).toBeNull();
  });
  it('missing estimate defaults to 1h: deadline tomorrow → max', () => {
    expect(derivedPriority({ deadline: dl(1) }, DEFAULT_SETTINGS, now)).toBe('max');
  });
});

describe('effectivePriority = max(manual, derived)', () => {
  it('deadline only ever escalates: manual max + far deadline stays max', () => {
    expect(effectivePriority({ priority: 'max', deadline: dl(60), estimateHours: 1 }, DEFAULT_SETTINGS, now)).toBe('max');
  });
  it('manual someday + far deadline floors at low', () => {
    expect(effectivePriority({ priority: 'someday', deadline: dl(60), estimateHours: 1 }, DEFAULT_SETTINGS, now)).toBe('low');
  });
  it('no deadline → manual as-is', () => {
    expect(effectivePriority({ priority: 'someday' }, DEFAULT_SETTINGS, now)).toBe('someday');
  });
});

describe('isEscalated', () => {
  it('true only when derived beats manual', () => {
    expect(isEscalated({ priority: 'low', deadline: dl(0) }, DEFAULT_SETTINGS, now)).toBe(true);
    expect(isEscalated({ priority: 'max', deadline: dl(0) }, DEFAULT_SETTINGS, now)).toBe(false);
    expect(isEscalated({ priority: 'low' }, DEFAULT_SETTINGS, now)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/priority.ts
import { daysUntilDeadline } from './time';
import { priorityRank, type Priority, type Settings, type Task } from './types';

/**
 * Deadline-based escalation (spec §4):
 *   slack = daysUntil(deadline) − ceil(estimate / hoursPerDay)
 *   ≤0 → max, ≤band → high, ≤band×2 → medium, else low (floor for deadlined tasks).
 */
export function derivedPriority(
  task: Pick<Task, 'deadline' | 'estimateHours'>,
  settings: Settings,
  now: Date,
): Priority | null {
  if (!task.deadline) return null;
  const workDays = Math.ceil((task.estimateHours ?? 1) / settings.hoursPerDay);
  const slack = daysUntilDeadline(task.deadline, now, settings.rolloverHour) - workDays;
  if (slack <= 0) return 'max';
  if (slack <= settings.slackBandDays) return 'high';
  if (slack <= settings.slackBandDays * 2) return 'medium';
  return 'low';
}

export function effectivePriority(
  task: Pick<Task, 'deadline' | 'estimateHours' | 'priority'>,
  settings: Settings,
  now: Date,
): Priority {
  const derived = derivedPriority(task, settings, now);
  if (derived === null) return task.priority;
  return priorityRank(derived) > priorityRank(task.priority) ? derived : task.priority;
}

export function isEscalated(
  task: Pick<Task, 'deadline' | 'estimateHours' | 'priority'>,
  settings: Settings,
  now: Date,
): boolean {
  const derived = derivedPriority(task, settings, now);
  return derived !== null && priorityRank(derived) > priorityRank(task.priority);
}
```

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `feat: add deadline-escalation priority derivation`

---

### Task 5: Randomizer draw

**Files:**
- Create: `src/lib/domain/randomizer.ts`
- Test: `src/lib/domain/randomizer.test.ts`

**Interfaces:**
- Consumes: `Task`, `Settings`, `priorityRank` (Task 2); `effectivePriority` (Task 4).
- Produces:

```ts
export interface DrawScope {
  listId?: string;      // list-view entry point OR the randomizer screen's list filter
  tagIds?: string[];    // tag filter: task matches if it carries ANY selected tag
  excludeIds?: string[]; // session "Not Now" set — transient, never persisted
}
export function eligibleForDraw(tasks: Task[], now: Date, scope?: DrawScope): Task[];
export function drawTask(tasks: Task[], settings: Settings, now: Date, rng: () => number, scope?: DrawScope): Task | null;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/randomizer.test.ts
import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Priority, type Task } from './types';
import { drawTask, eligibleForDraw } from './randomizer';

const now = new Date('2026-07-15T12:00:00');
let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'L1', name: 'task', notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});
const firstRng = () => 0; // always picks candidates[0]

describe('eligibleForDraw', () => {
  it('excludes completed, deleted, and snoozed; includes expired snoozes', () => {
    const pool = [
      task({ priority: 'high' }),
      task({ priority: 'high', completedAt: 5 }),
      task({ priority: 'high', deleted: true }),
      task({ priority: 'high', notTodayUntil: now.getTime() + 60_000 }),
      task({ priority: 'high', notTodayUntil: now.getTime() - 60_000 }),
    ];
    const ids = eligibleForDraw(pool, now).map((t) => t.id);
    expect(ids).toEqual([pool[0]!.id, pool[4]!.id]);
  });
  it('scopes to a list when asked', () => {
    const a = task({ priority: 'low', listId: 'A' });
    const b = task({ priority: 'low', listId: 'B' });
    expect(eligibleForDraw([a, b], now, { listId: 'B' })).toEqual([b]);
  });
  it('tag filter matches ANY selected tag; empty filter means no tag restriction', () => {
    const urgent = task({ priority: 'low', tagIds: ['urgent'] });
    const chill = task({ priority: 'low', tagIds: ['chill'] });
    const untagged = task({ priority: 'low' });
    expect(eligibleForDraw([urgent, chill, untagged], now, { tagIds: ['urgent', 'chill'] }))
      .toEqual([urgent, chill]);
    expect(eligibleForDraw([urgent, untagged], now, { tagIds: [] }))
      .toEqual([urgent, untagged]);
  });
  it('excludeIds ("Not Now" session set) removes tasks from the pool', () => {
    const a = task({ priority: 'high' });
    const b = task({ priority: 'high' });
    expect(eligibleForDraw([a, b], now, { excludeIds: [a.id] })).toEqual([b]);
  });
});

describe('drawTask — tier selection', () => {
  it('only draws from the highest non-empty effective tier', () => {
    const med = task({ priority: 'medium' });
    const hi1 = task({ priority: 'high' });
    const hi2 = task({ priority: 'high' });
    for (let i = 0; i < 20; i++) {
      const got = drawTask([med, hi1, hi2], DEFAULT_SETTINGS, now, Math.random);
      expect(['high']).toContain(got!.priority);
    }
  });
  it('someday is drawable only when nothing above exists', () => {
    const sd = task({ priority: 'someday' });
    expect(drawTask([sd], DEFAULT_SETTINGS, now, firstRng)!.id).toBe(sd.id);
    const lo = task({ priority: 'low' });
    expect(drawTask([sd, lo], DEFAULT_SETTINGS, now, firstRng)!.id).toBe(lo.id);
  });
  it('deadline escalation drives the tier (manual-low overdue beats manual-high)', () => {
    const overdueLow = task({ priority: 'low', deadline: '2026-07-10' });
    const plainHigh = task({ priority: 'high' });
    expect(drawTask([overdueLow, plainHigh], DEFAULT_SETTINGS, now, firstRng)!.id).toBe(overdueLow.id);
  });
  it('prefers in-progress tasks within the tier', () => {
    const fresh = task({ priority: 'high' });
    const started = task({ priority: 'high', inProgress: true });
    for (let i = 0; i < 20; i++) {
      expect(drawTask([fresh, started], DEFAULT_SETTINGS, now, Math.random)!.id).toBe(started.id);
    }
  });
  it('returns null when nothing is eligible', () => {
    expect(drawTask([task({ priority: 'high', completedAt: 1 })], DEFAULT_SETTINGS, now, firstRng)).toBeNull();
  });
  it('"Not Now" exclusion of the whole top tier falls through to the next tier', () => {
    const hi = task({ priority: 'high' });
    const med = task({ priority: 'medium' });
    expect(drawTask([hi, med], DEFAULT_SETTINGS, now, firstRng, { excludeIds: [hi.id] })!.id).toBe(med.id);
  });
  it('reaches every candidate in the tier (seeded sweep)', () => {
    const pool = [task({ priority: 'max' }), task({ priority: 'max' }), task({ priority: 'max' })];
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) seen.add(drawTask(pool, DEFAULT_SETTINGS, now, () => (i % 3) / 3)!.id);
    expect(seen.size).toBe(3);
  });
});
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/randomizer.ts
import { effectivePriority } from './priority';
import { priorityRank, type Settings, type Task } from './types';

export interface DrawScope {
  listId?: string;
  tagIds?: string[];     // match ANY; empty array = unrestricted
  excludeIds?: string[]; // session-only "Not Now" skips
}

/** Spec §4: "Not today" (notTodayUntil) affects ONLY this pool — nowhere else in the app. */
export function eligibleForDraw(tasks: Task[], now: Date, scope?: DrawScope): Task[] {
  const ts = now.getTime();
  const tagFilter = scope?.tagIds?.length ? new Set(scope.tagIds) : null;
  const excluded = scope?.excludeIds?.length ? new Set(scope.excludeIds) : null;
  return tasks.filter(
    (t) =>
      !t.deleted &&
      t.completedAt === undefined &&
      (t.notTodayUntil === undefined || t.notTodayUntil <= ts) &&
      (scope?.listId === undefined || t.listId === scope.listId) &&
      (tagFilter === null || t.tagIds.some((id) => tagFilter.has(id))) &&
      (excluded === null || !excluded.has(t.id)),
  );
}

export function drawTask(
  tasks: Task[],
  settings: Settings,
  now: Date,
  rng: () => number,
  scope?: DrawScope,
): Task | null {
  const pool = eligibleForDraw(tasks, now, scope);
  if (pool.length === 0) return null;
  const topRank = Math.max(...pool.map((t) => priorityRank(effectivePriority(t, settings, now))));
  const tier = pool.filter((t) => priorityRank(effectivePriority(t, settings, now)) === topRank);
  const started = tier.filter((t) => t.inProgress);
  const candidates = started.length > 0 ? started : tier;
  return candidates[Math.floor(rng() * candidates.length)] ?? null;
}
```

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `feat: add tiered randomizer draw with in-progress preference`

---

### Task 6: Recurrence engine

**Files:**
- Create: `src/lib/domain/recurrence.ts`
- Test: `src/lib/domain/recurrence.test.ts`

**Interfaces:**
- Consumes: `RecurrenceTemplate`, `RecurrenceMode`, `Task`, `TaskDraft`, `Settings` (Task 2); `addDaysKey`, `dateKey`, `appDayKey` (Task 3).
- Produces:

```ts
export function scheduleAfterCompletion(tpl: RecurrenceTemplate, completedAt: Date): number | null;
  // afterCompletion → nextSpawnAt timestamp (month-length clamped); null for scheduled modes
export function nextScheduledSpawn(mode: RecurrenceMode, after: Date, rolloverHour: number): number | null;
  // strictly-after next 4am spawn moment for weekly/monthly; null for afterCompletion
export interface SweepResult { drafts: TaskDraft[]; updates: Array<{ id: string; nextSpawnAt: number | undefined }> }
export function sweepSpawns(templates: RecurrenceTemplate[], tasks: Task[], now: Date, settings: Settings): SweepResult;
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/domain/recurrence.test.ts
import { describe, expect, it } from 'vitest';
import { nextScheduledSpawn, scheduleAfterCompletion, sweepSpawns } from './recurrence';
import { DEFAULT_SETTINGS, type RecurrenceTemplate, type Task } from './types';

const tpl = (over: Partial<RecurrenceTemplate>): RecurrenceTemplate => ({
  id: 'r1', listId: 'L1', name: 'water plants', notes: '', tagIds: [], priority: 'medium',
  mode: { kind: 'weekly', weekdays: [1] }, paused: false,
  createdAt: 0, updatedAt: 0, deleted: false, ...over,
});
const at = (s: string) => new Date(s);

describe('scheduleAfterCompletion', () => {
  it('adds days as exact offset', () => {
    const t = tpl({ mode: { kind: 'afterCompletion', interval: 3, unit: 'days' } });
    expect(scheduleAfterCompletion(t, at('2026-07-10T15:00:00')))
      .toBe(at('2026-07-13T15:00:00').getTime());
  });
  it('weeks multiply days', () => {
    const t = tpl({ mode: { kind: 'afterCompletion', interval: 2, unit: 'weeks' } });
    expect(scheduleAfterCompletion(t, at('2026-07-10T15:00:00')))
      .toBe(at('2026-07-24T15:00:00').getTime());
  });
  it('months clamp to month length (Jan 31 + 1mo → Feb 28 in 2027)', () => {
    const t = tpl({ mode: { kind: 'afterCompletion', interval: 1, unit: 'months' } });
    expect(scheduleAfterCompletion(t, at('2027-01-31T09:00:00')))
      .toBe(at('2027-02-28T09:00:00').getTime());
  });
  it('returns null for scheduled modes', () => {
    expect(scheduleAfterCompletion(tpl({}), at('2026-07-10T15:00:00'))).toBeNull();
  });
});

describe('nextScheduledSpawn', () => {
  it('weekly: next matching weekday at rollover hour, strictly after', () => {
    expect(nextScheduledSpawn({ kind: 'weekly', weekdays: [1] }, at('2026-07-15T12:00:00'), 4))
      .toBe(at('2026-07-20T04:00:00').getTime()); // Wed → next Mon
    expect(nextScheduledSpawn({ kind: 'weekly', weekdays: [1] }, at('2026-07-20T04:00:00'), 4))
      .toBe(at('2026-07-27T04:00:00').getTime()); // exactly at spawn moment → next week
  });
  it('weekly: multiple weekdays picks the soonest', () => {
    expect(nextScheduledSpawn({ kind: 'weekly', weekdays: [1, 5] }, at('2026-07-15T12:00:00'), 4))
      .toBe(at('2026-07-17T04:00:00').getTime()); // Wed → Fri before Mon
  });
  it('monthly: clamps day 31 in short months', () => {
    expect(nextScheduledSpawn({ kind: 'monthly', dayOfMonth: 31 }, at('2026-02-05T12:00:00'), 4))
      .toBe(at('2026-02-28T04:00:00').getTime());
    expect(nextScheduledSpawn({ kind: 'monthly', dayOfMonth: 31 }, at('2026-02-28T05:00:00'), 4))
      .toBe(at('2026-03-31T04:00:00').getTime());
  });
  it('returns null for afterCompletion', () => {
    expect(nextScheduledSpawn({ kind: 'afterCompletion', interval: 1, unit: 'days' }, at('2026-07-15T12:00:00'), 4)).toBeNull();
  });
});

describe('sweepSpawns', () => {
  const now = at('2026-07-20T05:00:00'); // Monday, past 4am
  const openInstance = (rid: string): Task => ({
    id: 'x1', listId: 'L1', name: 'water plants', notes: '', tagIds: [], priority: 'medium',
    inProgress: false, recurrenceId: rid, createdAt: 0, updatedAt: 0, deleted: false,
  });

  it('spawns a due scheduled template and advances nextSpawnAt', () => {
    const t = tpl({ nextSpawnAt: at('2026-07-20T04:00:00').getTime(), deadlineOffsetDays: 2, estimateHours: 1 });
    const res = sweepSpawns([t], [], now, DEFAULT_SETTINGS);
    expect(res.drafts).toHaveLength(1);
    const d = res.drafts[0]!;
    expect(d.recurrenceId).toBe('r1');
    expect(d.priority).toBe('medium');
    expect(d.deadline).toBe('2026-07-22'); // spawn app-day + offset 2
    expect(d.inProgress).toBe(false);
    expect(res.updates[0]!.nextSpawnAt).toBe(at('2026-07-27T04:00:00').getTime());
  });
  it('skip-if-open: no draft while an instance is open, but schedule still advances', () => {
    const t = tpl({ nextSpawnAt: at('2026-07-20T04:00:00').getTime() });
    const res = sweepSpawns([t], [openInstance('r1')], now, DEFAULT_SETTINGS);
    expect(res.drafts).toHaveLength(0);
    expect(res.updates[0]!.nextSpawnAt).toBe(at('2026-07-27T04:00:00').getTime());
  });
  it('afterCompletion spawns then clears nextSpawnAt', () => {
    const t = tpl({ mode: { kind: 'afterCompletion', interval: 3, unit: 'days' }, nextSpawnAt: now.getTime() - 1000 });
    const res = sweepSpawns([t], [], now, DEFAULT_SETTINGS);
    expect(res.drafts).toHaveLength(1);
    expect(res.updates[0]!.nextSpawnAt).toBeUndefined();
  });
  it('ignores paused, deleted, not-yet-due, and unscheduled templates', () => {
    const due = at('2026-07-20T04:00:00').getTime();
    const list = [
      tpl({ id: 'p', paused: true, nextSpawnAt: due }),
      tpl({ id: 'd', deleted: true, nextSpawnAt: due }),
      tpl({ id: 'f', nextSpawnAt: now.getTime() + 60_000 }),
      tpl({ id: 'u', nextSpawnAt: undefined }),
    ];
    const res = sweepSpawns(list, [], now, DEFAULT_SETTINGS);
    expect(res.drafts).toHaveLength(0);
    expect(res.updates).toHaveLength(0);
  });
});
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/domain/recurrence.ts
import { addDaysKey, appDayKey } from './time';
import type { RecurrenceMode, RecurrenceTemplate, Settings, Task, TaskDraft } from './types';

/** Month-add with clamping (Jan 31 + 1mo → Feb 28). */
function addMonthsClamped(d: Date, months: number): Date {
  const day = d.getDate();
  const target = new Date(d.getTime());
  target.setDate(1);
  target.setMonth(target.getMonth() + months);
  const lastDay = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
  target.setDate(Math.min(day, lastDay));
  return target;
}

/** afterCompletion: "come back X after done" (spec §5) — exact offset from completion. */
export function scheduleAfterCompletion(tpl: RecurrenceTemplate, completedAt: Date): number | null {
  const m = tpl.mode;
  if (m.kind !== 'afterCompletion') return null;
  if (m.unit === 'months') return addMonthsClamped(completedAt, m.interval).getTime();
  const days = m.unit === 'weeks' ? m.interval * 7 : m.interval;
  const d = new Date(completedAt.getTime());
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Weekly/monthly: the next spawn moment (rolloverHour on a due day), strictly after `after`. */
export function nextScheduledSpawn(mode: RecurrenceMode, after: Date, rolloverHour: number): number | null {
  if (mode.kind === 'weekly') {
    if (mode.weekdays.length === 0) return null;
    for (let i = 0; i <= 7; i++) {
      const c = new Date(after.getFullYear(), after.getMonth(), after.getDate() + i, rolloverHour);
      if (c.getTime() > after.getTime() && mode.weekdays.includes(c.getDay())) return c.getTime();
    }
    return null; // unreachable with a non-empty weekday set
  }
  if (mode.kind === 'monthly') {
    for (let i = 0; i <= 2; i++) {
      const first = new Date(after.getFullYear(), after.getMonth() + i, 1);
      const lastDay = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
      const c = new Date(first.getFullYear(), first.getMonth(), Math.min(mode.dayOfMonth, lastDay), rolloverHour);
      if (c.getTime() > after.getTime()) return c.getTime();
    }
    return null; // unreachable
  }
  return null;
}

export interface SweepResult {
  drafts: TaskDraft[];
  updates: Array<{ id: string; nextSpawnAt: number | undefined }>;
}

/** Materialize due templates. Runs at app open/focus and at 4am rollover (spec §3/§5). */
export function sweepSpawns(
  templates: RecurrenceTemplate[],
  tasks: Task[],
  now: Date,
  settings: Settings,
): SweepResult {
  const res: SweepResult = { drafts: [], updates: [] };
  for (const tpl of templates) {
    if (tpl.paused || tpl.deleted) continue;
    if (tpl.nextSpawnAt === undefined || tpl.nextSpawnAt > now.getTime()) continue;

    const hasOpenInstance = tasks.some(
      (t) => t.recurrenceId === tpl.id && !t.deleted && t.completedAt === undefined,
    );
    if (!hasOpenInstance) {
      res.drafts.push({
        listId: tpl.listId,
        name: tpl.name,
        notes: tpl.notes,
        priority: tpl.priority,
        tagIds: [...tpl.tagIds],
        estimateHours: tpl.estimateHours,
        deadline:
          tpl.deadlineOffsetDays === undefined
            ? undefined
            : addDaysKey(appDayKey(now, settings.rolloverHour), tpl.deadlineOffsetDays),
        inProgress: false,
        recurrenceId: tpl.id,
      });
    }
    // Scheduled modes advance to their next occurrence either way (skip-if-open, spec §5);
    // afterCompletion clears — completion of the new instance re-arms it.
    const next = nextScheduledSpawn(tpl.mode, now, settings.rolloverHour);
    res.updates.push({ id: tpl.id, nextSpawnAt: next ?? undefined });
  }
  return res;
}
```

- [ ] **Step 4: Run to verify pass** → PASS.
- [ ] **Step 5: Commit** — `feat: add recurrence engine (after-completion + scheduled, skip-if-open)`

---

### Task 7: IndexedDB persistence

**Files:**
- Create: `src/lib/storage/db.ts`, `src/lib/storage/repo.ts`
- Test: `src/lib/storage/repo.test.ts`

**Interfaces:**
- Consumes: all Task-2 types; `nanoid`.
- Produces (Phase 2's UI state layer is built on exactly these):

```ts
// db.ts
export class AppDb extends Dexie {
  lists!: Table<List, string>; tasks!: Table<Task, string>; tags!: Table<Tag, string>;
  templates!: Table<RecurrenceTemplate, string>; kv!: Table<{ key: string; value: unknown }, string>;
}
export function openDb(name?: string): AppDb;   // default name 'organizedchaos'

// repo.ts — every write stamps updatedAt (and createdAt on create); deletes are tombstones
export interface AppState {
  lists: List[]; tasks: Task[]; tags: Tag[]; templates: RecurrenceTemplate[];
  currentTask: CurrentTaskRef | null; settings: Settings;
}
export class Repo {
  constructor(db: AppDb);
  loadState(): Promise<AppState>;               // excludes tombstoned entities
  createList(fields: { title: string; areaGroup?: string }): Promise<List>;
  createTask(draft: TaskDraft): Promise<Task>;
  createTag(fields: { name: string; colorIndex: number }): Promise<Tag>;
  createTemplate(fields: Omit<RecurrenceTemplate, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>): Promise<RecurrenceTemplate>;
  updateTask(id: string, patch: Partial<Task>): Promise<void>;
  updateList(id: string, patch: Partial<List>): Promise<void>;
  updateTag(id: string, patch: Partial<Tag>): Promise<void>;
  updateTemplate(id: string, patch: Partial<RecurrenceTemplate>): Promise<void>;
  softDelete(table: 'lists' | 'tasks' | 'tags' | 'templates', id: string): Promise<void>;
  setCurrentTask(ref: CurrentTaskRef | null): Promise<void>;
  getSettings(): Promise<Settings>;             // DEFAULT_SETTINGS when unset
  updateSettings(patch: Partial<Settings>): Promise<void>;
}
```

- [ ] **Step 1: Write the failing test**

```ts
// src/lib/storage/repo.test.ts
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../domain/types';
import { openDb, type AppDb } from './db';
import { Repo } from './repo';

let db: AppDb;
let repo: Repo;
let dbN = 0;

beforeEach(() => {
  db = openDb(`test-${dbN++}`); // fresh db per test (fake-indexeddb via src/tests/setup.ts)
  repo = new Repo(db);
});

describe('Repo', () => {
  it('creates entities with ids and timestamps, and loads them back', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await repo.createList({ title: 'Home' });
    const task = await repo.createTask({
      listId: list.id, name: 'fix faucet', notes: '', priority: 'high',
      tagIds: [], inProgress: false,
    });
    expect(list.id).toBeTruthy();
    expect(task.createdAt).toBe(new Date('2026-07-15T12:00:00').getTime());
    const state = await repo.loadState();
    expect(state.lists.map((l) => l.id)).toEqual([list.id]);
    expect(state.tasks.map((t) => t.name)).toEqual(['fix faucet']);
    vi.useRealTimers();
  });

  it('updates stamp updatedAt without touching createdAt', async () => {
    vi.setSystemTime(new Date('2026-07-15T12:00:00'));
    const list = await repo.createList({ title: 'Home' });
    vi.setSystemTime(new Date('2026-07-15T13:00:00'));
    await repo.updateList(list.id, { title: 'House' });
    const state = await repo.loadState();
    expect(state.lists[0]!.title).toBe('House');
    expect(state.lists[0]!.createdAt).toBe(new Date('2026-07-15T12:00:00').getTime());
    expect(state.lists[0]!.updatedAt).toBe(new Date('2026-07-15T13:00:00').getTime());
    vi.useRealTimers();
  });

  it('softDelete tombstones: gone from loadState but still in the table', async () => {
    const list = await repo.createList({ title: 'Home' });
    await repo.softDelete('lists', list.id);
    expect((await repo.loadState()).lists).toHaveLength(0);
    expect((await db.lists.get(list.id))!.deleted).toBe(true);
  });

  it('currentTask round-trips including null', async () => {
    expect((await repo.loadState()).currentTask).toBeNull();
    await repo.setCurrentTask({ taskId: 'abc', acceptedAt: 123 });
    expect((await repo.loadState()).currentTask).toEqual({ taskId: 'abc', acceptedAt: 123 });
    await repo.setCurrentTask(null);
    expect((await repo.loadState()).currentTask).toBeNull();
  });

  it('settings default and merge', async () => {
    expect(await repo.getSettings()).toEqual(DEFAULT_SETTINGS);
    await repo.updateSettings({ hoursPerDay: 2 });
    expect(await repo.getSettings()).toEqual({ ...DEFAULT_SETTINGS, hoursPerDay: 2 });
  });

  it('data persists across a re-open of the same db name', async () => {
    const list = await repo.createList({ title: 'Persist' });
    db.close();
    const again = new Repo(openDb(db.name));
    expect((await again.loadState()).lists.map((l) => l.id)).toEqual([list.id]);
  });
});
```

- [ ] **Step 2: Run to verify fail** → FAIL.

- [ ] **Step 3: Implement**

```ts
// src/lib/storage/db.ts
import Dexie, { type Table } from 'dexie';
import type { List, RecurrenceTemplate, Tag, Task } from '../domain/types';

export class AppDb extends Dexie {
  lists!: Table<List, string>;
  tasks!: Table<Task, string>;
  tags!: Table<Tag, string>;
  templates!: Table<RecurrenceTemplate, string>;
  kv!: Table<{ key: string; value: unknown }, string>;

  constructor(name: string) {
    super(name);
    this.version(1).stores({
      lists: 'id, updatedAt',
      tasks: 'id, listId, updatedAt, completedAt, recurrenceId',
      tags: 'id, updatedAt',
      templates: 'id, updatedAt, nextSpawnAt',
      kv: 'key',
    });
  }
}

export function openDb(name = 'organizedchaos'): AppDb {
  return new AppDb(name);
}
```

```ts
// src/lib/storage/repo.ts
import { nanoid } from 'nanoid';
import {
  DEFAULT_SETTINGS,
  type CurrentTaskRef, type List, type RecurrenceTemplate, type Settings,
  type Tag, type Task, type TaskDraft,
} from '../domain/types';
import type { AppDb } from './db';

export interface AppState {
  lists: List[]; tasks: Task[]; tags: Tag[]; templates: RecurrenceTemplate[];
  currentTask: CurrentTaskRef | null; settings: Settings;
}

/** Base-entity fields for a new row; Date.now() so vi.setSystemTime works in tests. */
function stamp(): { id: string; createdAt: number; updatedAt: number; deleted: false } {
  const now = Date.now();
  return { id: nanoid(), createdAt: now, updatedAt: now, deleted: false };
}

export class Repo {
  constructor(private db: AppDb) {}

  async loadState(): Promise<AppState> {
    const [lists, tasks, tags, templates, currentRow, settingsRow] = await Promise.all([
      this.db.lists.toArray(), this.db.tasks.toArray(), this.db.tags.toArray(),
      this.db.templates.toArray(), this.db.kv.get('currentTask'), this.db.kv.get('settings'),
    ]);
    const live = <T extends { deleted: boolean }>(rows: T[]) => rows.filter((r) => !r.deleted);
    return {
      lists: live(lists), tasks: live(tasks), tags: live(tags), templates: live(templates),
      currentTask: (currentRow?.value as CurrentTaskRef | null | undefined) ?? null,
      settings: { ...DEFAULT_SETTINGS, ...((settingsRow?.value as Partial<Settings>) ?? {}) },
    };
  }

  async createList(fields: { title: string; areaGroup?: string }): Promise<List> {
    const row: List = { ...stamp(), sortMode: 'priority', ...fields };
    await this.db.lists.put(row);
    return row;
  }

  async createTask(draft: TaskDraft): Promise<Task> {
    const row: Task = { ...stamp(), ...draft };
    await this.db.tasks.put(row);
    return row;
  }

  async createTag(fields: { name: string; colorIndex: number }): Promise<Tag> {
    const row: Tag = { ...stamp(), ...fields };
    await this.db.tags.put(row);
    return row;
  }

  async createTemplate(
    fields: Omit<RecurrenceTemplate, 'id' | 'createdAt' | 'updatedAt' | 'deleted'>,
  ): Promise<RecurrenceTemplate> {
    const row: RecurrenceTemplate = { ...stamp(), ...fields };
    await this.db.templates.put(row);
    return row;
  }

  private async patchRow<T extends { updatedAt: number }>(
    table: { update: (id: string, changes: object) => Promise<number> },
    id: string,
    patch: Partial<T>,
  ): Promise<void> {
    await table.update(id, { ...patch, updatedAt: Date.now() });
  }

  updateTask(id: string, patch: Partial<Task>) { return this.patchRow(this.db.tasks, id, patch); }
  updateList(id: string, patch: Partial<List>) { return this.patchRow(this.db.lists, id, patch); }
  updateTag(id: string, patch: Partial<Tag>) { return this.patchRow(this.db.tags, id, patch); }
  updateTemplate(id: string, patch: Partial<RecurrenceTemplate>) { return this.patchRow(this.db.templates, id, patch); }

  async softDelete(table: 'lists' | 'tasks' | 'tags' | 'templates', id: string): Promise<void> {
    await this.db[table].update(id, { deleted: true, updatedAt: Date.now() });
  }

  async setCurrentTask(ref: CurrentTaskRef | null): Promise<void> {
    await this.db.kv.put({ key: 'currentTask', value: ref });
  }

  async getSettings(): Promise<Settings> {
    const row = await this.db.kv.get('settings');
    return { ...DEFAULT_SETTINGS, ...((row?.value as Partial<Settings>) ?? {}) };
  }

  async updateSettings(patch: Partial<Settings>): Promise<void> {
    const current = await this.getSettings();
    await this.db.kv.put({ key: 'settings', value: { ...current, ...patch } });
  }
}
```

- [ ] **Step 4: Run to verify pass** — `npx vitest run src/lib/storage/repo.test.ts` → PASS. Then run the whole suite: `npm test` → all green.
- [ ] **Step 5: Commit** — `feat: add IndexedDB persistence layer (Dexie) with tombstones + stamping`

---

### Task 8: Playwright smoke test

**Files:**
- Create: `playwright.config.ts`, `e2e/smoke.spec.ts`

**Interfaces:**
- Consumes: the Task-1 shell (`wordmark` heading, title).
- Produces: `npm run e2e` green locally (chromium + webkit) and `npx playwright test --project=chromium` for CI (Task 9 uses exactly this command).

- [ ] **Step 1: Write the config + failing-by-absence check**

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  webServer: {
    command: 'npm run build && npm run preview',
    url: 'http://localhost:4173/organizedchaos/',
    reuseExistingServer: !process.env.CI,
  },
  use: { baseURL: 'http://localhost:4173/organizedchaos/' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'webkit', use: { ...devices['iPhone 15'] } },
  ],
});
```

```ts
// e2e/smoke.spec.ts
import { expect, test } from '@playwright/test';

test('app shell boots with theme and wordmark', async ({ page }) => {
  await page.goto('./');
  await expect(page).toHaveTitle('Organized Chaos');
  await expect(page.getByRole('heading', { name: /organized\s*chaos/i })).toBeVisible();
  const bg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  expect(bg).toBe('rgb(11, 14, 20)'); // --bg0, proves theme CSS actually loaded
});
```

- [ ] **Step 2: Install browsers** — Run: `npx playwright install chromium webkit`
- [ ] **Step 3: Run to verify pass** — `npm run e2e` → both projects PASS. (If webkit fails on a Mac-version quirk, note it and keep chromium as the CI gate.)
- [ ] **Step 4: Commit** — `test: add Playwright smoke test (chromium + iPhone-sized webkit)`

---

### Task 9: CI → GitHub Pages deploy + README

**Files:**
- Create: `.github/workflows/deploy.yml`, `README.md`

**Interfaces:**
- Consumes: `npm test`, `npm run build`, `npx playwright test --project=chromium` (Tasks 1–8).
- Produces: live app at `https://coolblueflame.github.io/organizedchaos/` on every push to main.

- [ ] **Step 1: Write the workflow**

```yaml
# .github/workflows/deploy.yml
name: test-and-deploy
on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: true

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: npm run check
      - run: npm test
      - run: npx playwright install chromium --with-deps
      - run: npx playwright test --project=chromium
      - run: npm run build
      - uses: actions/configure-pages@v5
        with:
          enablement: true
      - uses: actions/upload-pages-artifact@v3
        with:
          path: dist
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
```

- [ ] **Step 2: Write README.md** — short: what the app is (one paragraph, the randomizer hook), link to the live URL, "built almost entirely by Claude" note if Ben likes, pointer to `docs/superpowers/specs/` for design, local dev commands (`npm install`, `npm run dev`, `npm test`, `npm run e2e`). No personal data.

- [ ] **Step 3: Commit + push** — `ci: add test + GitHub Pages deploy workflow` then `git -C . push`.

- [ ] **Step 4: Verify the deploy end-to-end**

Run: `gh run watch --repo coolblueflame/organizedchaos --exit-status` (get the run id from `gh run list` first)
Expected: workflow green. If `configure-pages` enablement fails for permissions, fall back to: `gh api -X POST repos/coolblueflame/organizedchaos/pages -f build_type=workflow`, re-run, and if that also fails, add "enable Pages in repo Settings → Pages → Source: GitHub Actions" to Ben's checklist and notify.

Run: `curl -sI https://coolblueflame.github.io/organizedchaos/`
Expected: `HTTP/2 200` and the page serves the app (allow a minute for CDN propagation).

- [ ] **Step 5: Notify Ben** — push notification: first deploy is live with the URL; installing it can wait until Phase 2 makes it worth a home-screen slot.

---

## Self-Review Notes

- **Spec coverage (Phase 1 scope):** §3 types/defaults → Tasks 2, 7 · §3 4am rule → Task 3 · §4 formula + draw (incl. "Not today only affects the randomizer", in-progress preference, Someday-bottom) → Tasks 4, 5 · §5 recurrence incl. nextSpawnAt fix + skip-if-open → Task 6 · §2 hosting/CI → Task 9 · §7 theme tokens → Task 1. Deliberately deferred to later phases per spec §11: UI screens (2), randomizer UX (3), recurrence UI (4), juice (5), sync (6), import (7), stats (8), PWA manifest/offline (9).
- **Type consistency:** `notTodayUntil`/`completedAt` are optional numbers tested with `undefined` checks everywhere; `TaskDraft` = `Omit<Task, 'id'|'createdAt'|'updatedAt'|'deleted'>` and is what `sweepSpawns` emits and `createTask` accepts; `sweepSpawns` clears via `nextSpawnAt: undefined` and `Repo.updateTemplate` persists it.
- **Known judgment calls:** `stamp()` uses `Date.now()` (not injected clock) — tests control it via `vi.setSystemTime`; Dexie `update()` with `undefined` values: Dexie applies `undefined` as a real change with `put` semantics on update — verify during Task 7 that clearing `nextSpawnAt` actually persists; if not, use `Dexie.delete`-key modify or store `null`.
