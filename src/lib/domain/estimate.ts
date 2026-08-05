/**
 * Estimate input parsing (2026-08-01 ask): people think in minutes as often
 * as hours, and forcing the decimal-hours conversion ("45 minutes… so 0.75?")
 * is exactly the mental math an estimate field shouldn't demand.
 *
 * Accepted: "1.5" (hours, the old behaviour) · "1.5h" · "90m" · "1h30m" ·
 * "1h 30m" · "1:30" (h:mm) — case-insensitive, spaces ignored.
 * Returns hours, or null when the text doesn't parse to a positive time.
 */
export function parseEstimate(raw: string): number | null {
  const s = raw.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;

  const clock = s.match(/^(\d+):([0-5]\d)$/);
  if (clock) {
    const v = parseInt(clock[1]!, 10) + parseInt(clock[2]!, 10) / 60;
    return v > 0 ? round(v) : null;
  }

  const hm = s.match(/^(?:(\d+(?:[.,]\d+)?)h(?:ours?|rs?)?)?(?:(\d+(?:[.,]\d+)?)m(?:ins?|inutes?)?)?$/);
  if (hm && (hm[1] !== undefined || hm[2] !== undefined)) {
    const h = hm[1] ? parseFloat(hm[1].replace(',', '.')) : 0;
    const m = hm[2] ? parseFloat(hm[2].replace(',', '.')) : 0;
    const v = h + m / 60;
    return v > 0 ? round(v) : null;
  }

  const plain = parseFloat(s.replace(',', '.'));
  return Number.isFinite(plain) && plain > 0 ? round(plain) : null;
}

/** Two decimals is plenty — estimates are vibes, not invoices. */
const round = (v: number) => Math.round(v * 100) / 100;

/** The placeholder every estimate field shares, so the syntax teaches itself. */
export const ESTIMATE_HINT = 'e.g. 2h or 45m';

/**
 * Hours back into the compact form a person would type: 0.75 → "45m",
 * 1.5 → "1h 30m", 2 → "2h".
 *
 * The field shows THIS rather than the stored number, so typing "45m" and
 * looking back at "45m" agrees with itself. Seeing "0.75" instead reads like
 * the app misunderstood, even though it understood perfectly.
 */
export function formatEstimate(hours: number | undefined): string {
  if (hours === undefined || !(hours > 0)) return '';
  const whole = Math.floor(hours);
  const minutes = Math.round((hours - whole) * 60);
  if (whole === 0) return `${minutes}m`;
  if (minutes === 0) return `${whole}h`;
  return `${whole}h ${minutes}m`;
}
