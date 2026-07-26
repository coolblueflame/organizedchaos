/**
 * The 16-color tag swatch (spec §3/§7) — hand-picked for distinguishability on
 * the dark theme. Tag.colorIndex indexes into this array; order is stable
 * forever (persisted data depends on it), append-only if it ever grows.
 */
export const TAG_COLORS: readonly string[] = [
  '#79c0ff', // blue
  '#a5d6ff', // sky
  '#56d4dd', // cyan
  '#4dd0b1', // teal
  '#7ee787', // green
  '#b8e986', // lime
  '#e3b341', // yellow
  '#ffa657', // orange
  '#f0883e', // amber
  '#ff7b72', // red
  '#ff9e9e', // coral
  '#f778ba', // magenta
  '#d2a8ff', // purple
  '#b3a2f7', // lavender
  '#8b949e', // grey
  '#c9d1d9', // silver
];

export function tagColor(index: number): string {
  return TAG_COLORS[((index % TAG_COLORS.length) + TAG_COLORS.length) % TAG_COLORS.length]!;
}
