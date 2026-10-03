/**
 * SPOILER ZONE — seasons and occasions: date-driven touches (a tagline, an
 * accent, a costume for the companion, a moment, a letter in the mailbox,
 * a few lines). Pure: a season is a function of the app-day and the ledger,
 * so the engine, the screens and every device agree on it without asking.
 */
import { latestChoice } from './ledger';
import type { MomentName } from './registry';

export type Season = 'halloween' | 'winter' | 'new-year' | 'anniversary' | 'birthday';

/** Ledger prefix of the seasonal-touches switch: `seasonal:on` / `seasonal:off`, newest wins. */
export const SEASONAL_PREFIX = 'seasonal:';
/**
 * Ledger key of the reader's birthday answer. One key, not one per answer:
 * the ledger can never delete a key, so a date kept under its own key would
 * outlive "forget it". Instead the value packs the answer with the moment
 * it was given (see birthdayValue), and the merge's larger-value rule keeps
 * the newest answer and drops the rest.
 */
export const BIRTHDAY_KEY = 'birthday';
/** Older form of the answer, one key per option (`birthday:MM-DD` / `birthday:none`); read, never written. */
const LEGACY_BIRTHDAY_PREFIX = 'birthday:';

/** Lifetime completions before ENTROPY asks about a birthday: settled in, not brand new. */
export const BIRTHDAY_ASK_AT = 50;

/** Seasonal touches are on unless switched off. */
export function seasonalEnabled(marks: Readonly<Record<string, number>>): boolean {
  return latestChoice(marks, SEASONAL_PREFIX) !== 'off';
}

export interface MonthDay { month: number; day: number }

/**
 * A birthday answer as one ledger value: the whole second it was given,
 * times 10⁴, plus MMDD (0 for "no thanks"). MMDD never reaches 10⁴, so a
 * later answer is always the larger value; today's seconds times 10⁴ stay
 * far below 2⁵³, so the value is exact.
 */
export function birthdayValue(b: MonthDay | null, stampSeconds: number): number {
  return stampSeconds * 10_000 + (b ? b.month * 100 + b.day : 0);
}

/** The value for a new answer: stamped now, or one second past the answer it replaces. */
export function nextBirthdayValue(marks: Readonly<Record<string, number>>, b: MonthDay | null, nowMs = Date.now()): number {
  const previous = Math.floor((marks[BIRTHDAY_KEY] ?? 0) / 10_000);
  return birthdayValue(b, Math.max(Math.floor(nowMs / 1000), previous + 1));
}

function asMonthDay(month: number, day: number): MonthDay | null {
  return month >= 1 && month <= 12 && day >= 1 && day <= 31 ? { month, day } : null;
}

/** The reader's birthday, if they shared one and have not since taken it back. */
export function birthdayOf(marks: Readonly<Record<string, number>>): MonthDay | null {
  const packed = marks[BIRTHDAY_KEY];
  if (packed !== undefined) {
    const mmdd = packed % 10_000;
    return mmdd === 0 ? null : asMonthDay(Math.floor(mmdd / 100), mmdd % 100);
  }
  const m = latestChoice(marks, LEGACY_BIRTHDAY_PREFIX)?.match(/^(\d\d)-(\d\d)$/);
  return m ? asMonthDay(Number(m[1]), Number(m[2])) : null;
}

/** Whether the reader has answered the birthday question either way. */
export function birthdayAnswered(marks: Readonly<Record<string, number>>): boolean {
  return marks[BIRTHDAY_KEY] !== undefined || latestChoice(marks, LEGACY_BIRTHDAY_PREFIX) !== null;
}

/**
 * The season an app-day (YYYY-MM-DD) falls in, or null for an ordinary day.
 * A birthday outranks everything; a 29 February birthday is kept on the
 * 28th in the years without a 29th, so it still comes round every year.
 */
export function seasonOn(dayKey: string, birthday: MonthDay | null): Season | null {
  const [y, month, day] = dayKey.split('-').map(Number) as [number, number, number];
  if (birthday) {
    const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
    const bday = birthday.month === 2 && birthday.day === 29 && !leap ? 28 : birthday.day;
    if (month === birthday.month && day === bday) return 'birthday';
  }
  if ((month === 12 && day === 31) || (month === 1 && day <= 2)) return 'new-year';
  if (month === 10 && day >= 17) return 'halloween';
  if (month === 12) return 'winter';
  if (month === 7 && day === 26) return 'anniversary';
  return null;
}

/** The season in force for a library on an app-day: null when touches are off. */
export function activeSeason(dayKey: string, marks: Readonly<Record<string, number>>): Season | null {
  if (!seasonalEnabled(marks)) return null;
  return seasonOn(dayKey, birthdayOf(marks));
}

/**
 * Which occurrence of a season an app-day belongs to, for things that happen
 * once per occurrence (the mailbox letter). New Year straddles two years and
 * is named for the one it opens.
 */
export function seasonOccurrence(season: Season, dayKey: string): string {
  const [y, m] = dayKey.split('-').map(Number) as [number, number];
  return `${season}-${season === 'new-year' && m === 12 ? y + 1 : y}`;
}

/** `name` if it names a season, else null: for test hooks that name one in storage. */
export function namedSeason(name: string | null): Season | null {
  return name !== null && Object.hasOwn(SEASON_MOMENTS, name) ? (name as Season) : null;
}

/** Moments that only ever appear in their own season, never in the year-round roll. */
export const SEASON_MOMENTS: Readonly<Record<Season, MomentName>> = {
  halloween: 'eyes-in-the-dark',
  winter: 'snowfall',
  'new-year': 'fireworks',
  anniversary: 'balloons',
  birthday: 'balloons',
};

/** Seasonal-only moments: the year-round roll leaves these out. */
export const SEASONAL_ONLY_MOMENTS: ReadonlySet<MomentName> = new Set(['eyes-in-the-dark', 'snowfall', 'balloons']);
