<!--
  Single-series bar chart (SVG, zero deps). Dataviz discipline: thin rounded
  marks, recessive grid, ink-token text, per-bar hover tooltip, sparse x labels,
  no legend (the figure title names the series).
-->
<script lang="ts">
  let { points, color, unit = '' }: {
    points: Array<{ key: string; label: string; count: number }>;
    color: string;
    unit?: string;
  } = $props();

  const W = 600;
  const H = 180;
  const PAD = { top: 12, right: 8, bottom: 22, left: 30 };

  let hover = $state<number | null>(null);

  const max = $derived(Math.max(1, ...points.map((p) => p.count)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = $derived(innerW / Math.max(1, points.length));
  const barW = $derived(Math.max(3, Math.min(26, step - 2))); // ≥2px surface gap between bars
  const x = (i: number) => PAD.left + i * step + (step - barW) / 2;
  const y = (v: number) => PAD.top + innerH * (1 - v / max);
  const labelEvery = $derived(Math.max(1, Math.ceil(points.length / 6)));
  // Dedupe: at small maxima both fractions can round to the same tick
  // (max=1 → round(0.5)=round(1)=1), which would duplicate the each-key.
  const gridLines = $derived.by(() => {
    const ls = [0.5, 1].map((f) => ({ v: Math.round(max * f), yy: y(max * f) }));
    return ls.filter((g, i) => ls.findIndex((o) => o.v === g.v) === i);
  });
</script>

<div class="wrap">
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="bar chart">
    {#each gridLines as g (g.v)}
      <line x1={PAD.left} x2={W - PAD.right} y1={g.yy} y2={g.yy} class="grid" />
      <text x={PAD.left - 6} y={g.yy + 3} class="tick" text-anchor="end">{g.v}</text>
    {/each}
    <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} class="axis" />
    {#each points as p, i (p.key)}
      {#if p.count > 0}
        <rect x={x(i)} y={y(p.count)} width={barW} height={Math.max(2, PAD.top + innerH - y(p.count))}
          rx="3" fill={color} opacity={hover === null || hover === i ? 1 : 0.45} />
      {/if}
      {#if i % labelEvery === 0}
        <text x={x(i) + barW / 2} y={H - 6} class="tick" text-anchor="middle">{p.label}</text>
      {/if}
      <rect x={PAD.left + i * step} y={PAD.top} width={step} height={innerH}
        fill="transparent" role="presentation"
        onpointerenter={() => (hover = i)} onpointerleave={() => (hover = null)} />
      {#if hover === i}
        <text x={Math.min(W - 30, Math.max(PAD.left + 14, x(i) + barW / 2))} y={Math.max(10, y(p.count) - 5)}
          class="value" text-anchor="middle">{p.count}{unit}</text>
      {/if}
    {/each}
  </svg>
</div>

<style>
  .wrap { width: 100%; }
  svg { width: 100%; height: auto; display: block; }
  .grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 4; }
  .axis { stroke: var(--line); stroke-width: 1; }
  .tick { fill: var(--dim); font-family: var(--font-mono); font-size: 9px; }
  .value { fill: var(--text); font-family: var(--font-mono); font-size: 11px; font-weight: 700; }
</style>
