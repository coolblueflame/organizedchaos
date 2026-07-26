# Phase 8: Stats Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Home stats strip (today/week/month/year/lifetime completions, animated count-up) and the stats screen: completions-over-time bars (day/week/month toggle), the estimated-time-to-completion tile with its 1-hour-assumption tooltip, and the backlog-burden-over-time line — reconstructed retroactively so imported Things history shows up immediately.

**Chart discipline (dataviz skill applied):** stat tiles for headline numbers (not charts); single-series bar for completions (magnitude over time, `--acc-green`); single-series line+area for burden (`--acc-orange`); both single-series → no legends, titles name the series; hover tooltips (per-bar / crosshair); values in ink tokens, marks recessive grid; `<details>` table view per chart for accessibility; hues validated for contrast on the dark surface (≥3:1 pass; adjacency checks N/A — the hues never share a chart). Hand-rolled SVG, zero dependencies, reduced-motion honored (no count-up animation).

## Tasks

1. **`src/lib/domain/stats.ts` (TDD)**:
```ts
completionCounts(tasks, now, rolloverHour): { today; week; month; year; lifetime }
  // calendar buckets on APP-days (4am rule); week starts Monday
completionSeries(tasks, granularity: 'day'|'week'|'month', bucketCount, now, rolloverHour):
  Array<{ key: string; label: string; count: number }>   // oldest → newest, zero-filled
totalEstimateHours(tasks): number                        // open, non-deleted; estimate ?? 1
formatDuration(hours): string
  // literal: 1y=365d, 1mo=30d, 1w=7d, 1d=24h; two most-significant units ("3w 2d"); "0h" floor
burdenSeries(tasks, sampleDays, now, rolloverHour): Array<{ key: string; hours: number }>
  // per sampled app-day D: Σ (estimate ?? 1) over tasks with createdAt ≤ end(D),
  // not completed by D (completedAt undefined or > end(D)),
  // not deleted by D (tombstone updatedAt > end(D) — a tombstone's last write IS its deletion),
  // span auto-fit: from earliest createdAt (clamped ≤ 365 samples) to today
```
Tests: 4am bucketing, Monday weeks, zero-fill, week/month keys, estimate defaulting, burden reconstruction incl. completion/deletion cliffs and future-created exclusion, formatDuration table (0h, 45m→"1h"? no — hours floor at h granularity, "26h"→"1d 2h", "8760h"→"1y").

2. **UI**: `StatsStrip.svelte` on Home above the wordmark (5 tiles, count-up via rAF unless reduced-motion; tap → `#/stats`); `StatsView.svelte` (route + back): est-time hero tile with ⓘ tooltip ("assumes 1 hour for any task without an estimate"), completions `BarChart.svelte`, burden `LineChart.svelte`, granularity segmented control, hover tooltips, `<details>` data tables. Charts are dumb components taking `{ points, color, format }`.

3. **Gate**: unit+check+e2e (one stats e2e: seed, complete 2 tasks, strip shows 2, stats screen renders both charts + toggle works), screenshot self-review, CI, live verify, memory.
