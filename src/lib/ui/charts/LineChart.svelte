<!--
  Single-series line+area chart (SVG, zero deps) with crosshair hover.
  Same dataviz discipline as BarChart.
-->
<script lang="ts">
  let { points, color, format = (v: number) => String(v) }: {
    points: Array<{ key: string; hours: number }>;
    color: string;
    format?: (v: number) => string;
  } = $props();

  const W = 600;
  const H = 180;
  const PAD = { top: 12, right: 8, bottom: 22, left: 38 };

  let hover = $state<number | null>(null);

  const max = $derived(Math.max(1, ...points.map((p) => p.hours)));
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (points.length <= 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => PAD.top + innerH * (1 - v / max);
  const linePath = $derived(points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.hours).toFixed(1)}`).join(' '));
  const areaPath = $derived(`${linePath} L${x(points.length - 1).toFixed(1)},${PAD.top + innerH} L${x(0).toFixed(1)},${PAD.top + innerH} Z`);
  const labelEvery = $derived(Math.max(1, Math.ceil(points.length / 5)));
  const gridLines = $derived([0.5, 1].map((f) => ({ v: max * f, yy: y(max * f) })));

  function onMove(e: PointerEvent) {
    const svg = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
    const px = ((e.clientX - svg.left) / svg.width) * W;
    const i = Math.round(((px - PAD.left) / innerW) * (points.length - 1));
    hover = Math.max(0, Math.min(points.length - 1, i));
  }
</script>

<div class="wrap">
  <svg viewBox="0 0 {W} {H}" preserveAspectRatio="none" role="img" aria-label="line chart"
    onpointermove={onMove} onpointerleave={() => (hover = null)}>
    {#each gridLines as g (g.yy)}
      <line x1={PAD.left} x2={W - PAD.right} y1={g.yy} y2={g.yy} class="grid" />
      <text x={PAD.left - 6} y={g.yy + 3} class="tick" text-anchor="end">{format(Math.round(g.v))}</text>
    {/each}
    <line x1={PAD.left} x2={W - PAD.right} y1={PAD.top + innerH} y2={PAD.top + innerH} class="axis" />
    {#if points.length > 0}
      <path d={areaPath} fill={color} opacity="0.12" />
      <path d={linePath} fill="none" stroke={color} stroke-width="2" stroke-linejoin="round" />
    {/if}
    {#each points as p, i (p.key)}
      {#if i % labelEvery === 0}
        <text x={x(i)} y={H - 6} class="tick" text-anchor="middle">{p.key.slice(5)}</text>
      {/if}
    {/each}
    {#if hover !== null && points[hover]}
      {@const hp = points[hover]!}
      <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} class="crosshair" />
      <circle cx={x(hover)} cy={y(hp.hours)} r="4.5" fill={color} stroke="var(--bg1)" stroke-width="2" />
      <text x={Math.min(W - 44, Math.max(PAD.left + 30, x(hover)))} y={Math.max(10, y(hp.hours) - 9)}
        class="value" text-anchor="middle">{format(hp.hours)} · {hp.key.slice(5)}</text>
    {/if}
  </svg>
</div>

<style>
  .wrap { width: 100%; }
  svg { width: 100%; height: auto; display: block; touch-action: none; }
  .grid { stroke: var(--line); stroke-width: 1; stroke-dasharray: 2 4; }
  .axis { stroke: var(--line); stroke-width: 1; }
  .crosshair { stroke: var(--dim); stroke-width: 1; stroke-dasharray: 3 3; }
  .tick { fill: var(--dim); font-family: var(--font-mono); font-size: 9px; }
  .value { fill: var(--text); font-family: var(--font-mono); font-size: 11px; font-weight: 700; }
</style>
