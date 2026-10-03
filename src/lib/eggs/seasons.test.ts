import { describe, expect, it } from 'vitest';
import {
  SEASON_MOMENTS, SEASONAL_ONLY_MOMENTS, activeSeason, birthdayAnswered, birthdayKey, birthdayOf,
  seasonOccurrence, seasonOn, type Season,
} from './seasons';
import { latestChoice } from './ledger';
import { SEASON_LOOKS } from './content/seasons';
import { MOMENTS } from './registry';

describe('latestChoice', () => {
  it('is the newest stamp under the prefix, and nothing else counts', () => {
    expect(latestChoice({}, 'wear:')).toBeNull();
    expect(latestChoice({ 'wear:bow': 5, 'wear:hat': 9, 'seasonal:off': 99 }, 'wear:')).toBe('hat');
  });
});

describe('seasonOn', () => {
  it('knows the calendar', () => {
    expect(seasonOn('2026-10-16', null)).toBeNull();
    expect(seasonOn('2026-10-17', null)).toBe('halloween');
    expect(seasonOn('2026-10-31', null)).toBe('halloween');
    expect(seasonOn('2026-11-01', null)).toBeNull();
    expect(seasonOn('2026-12-01', null)).toBe('winter');
    expect(seasonOn('2026-12-30', null)).toBe('winter');
    expect(seasonOn('2026-12-31', null)).toBe('new-year');
    expect(seasonOn('2027-01-02', null)).toBe('new-year');
    expect(seasonOn('2027-01-03', null)).toBeNull();
    expect(seasonOn('2027-07-26', null)).toBe('anniversary');
  });

  it('puts a birthday above everything, Halloween included', () => {
    expect(seasonOn('2026-10-31', { month: 10, day: 31 })).toBe('birthday');
    expect(seasonOn('2026-10-30', { month: 10, day: 31 })).toBe('halloween');
  });

  it('keeps a leap-day birthday on the 28th in other years', () => {
    const leapling = { month: 2, day: 29 };
    expect(seasonOn('2027-02-28', leapling)).toBe('birthday');
    expect(seasonOn('2028-02-28', leapling)).toBeNull();
    expect(seasonOn('2028-02-29', leapling)).toBe('birthday');
  });
});

describe('the ledger switches', () => {
  it('seasonal touches are on until switched off, and the newest switch wins', () => {
    expect(activeSeason('2026-10-20', {})).toBe('halloween');
    expect(activeSeason('2026-10-20', { 'seasonal:off': 2 })).toBeNull();
    expect(activeSeason('2026-10-20', { 'seasonal:off': 2, 'seasonal:on': 3 })).toBe('halloween');
  });

  it('a birthday is shared, changed, or taken back by stamping', () => {
    expect(birthdayAnswered({})).toBe(false);
    const shared = { [birthdayKey({ month: 3, day: 7 })]: 1 };
    expect(Object.keys(shared)).toEqual(['birthday:03-07']);
    expect(birthdayOf(shared)).toEqual({ month: 3, day: 7 });
    const declined = { ...shared, [birthdayKey(null)]: 2 };
    expect(birthdayOf(declined)).toBeNull();
    expect(birthdayAnswered(declined), 'a no is an answer too').toBe(true);
  });
});

describe('seasonOccurrence', () => {
  it('names New Year for the year it opens, from either side of midnight', () => {
    expect(seasonOccurrence('new-year', '2026-12-31')).toBe('new-year-2027');
    expect(seasonOccurrence('new-year', '2027-01-02')).toBe('new-year-2027');
    expect(seasonOccurrence('halloween', '2026-10-20')).toBe('halloween-2026');
  });
});

describe('season content', () => {
  const seasons = Object.keys(SEASON_LOOKS) as Season[];

  it('every season has a moment that exists, and lines that fit', () => {
    for (const s of seasons) {
      expect(MOMENTS as readonly string[]).toContain(SEASON_MOMENTS[s]);
      const look = SEASON_LOOKS[s];
      expect(look.lines.length, s).toBeGreaterThanOrEqual(3);
      for (const line of [...look.lines, look.letter.text, look.letter.subject, look.tagline]) {
        expect(line.length, line).toBeLessThanOrEqual(200);
        expect(line, 'no em dashes in reader-facing copy').not.toContain('—');
      }
    }
  });

  it('seasonal-only moments all belong to some season', () => {
    const owned = new Set(Object.values(SEASON_MOMENTS));
    for (const m of SEASONAL_ONLY_MOMENTS) expect(owned.has(m), m).toBe(true);
  });
});
