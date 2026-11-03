import { describe, expect, it } from 'vitest';
import {
  DEN_MARKS, DEN_OPENS_AT, SCRAPBOOK, TRINKETS, WEARABLE_ADORNMENTS, companionForm, costumeId, denOpen, momentsSeen,
  outfit, splitForm, type DenProgress,
} from './den';
import { MOMENTS } from './registry';
import { PET_STAGES } from './content/extras';
import { SEASON_LOOKS } from './content/seasons';

describe('the den door', () => {
  it('opens at the dragon rung, and stays open once visited', () => {
    expect(DEN_OPENS_AT, 'the rung the companion becomes a dragon').toBe(PET_STAGES.find(([, f]) => f === '🐲')![0]);
    expect(denOpen(DEN_OPENS_AT - 1, {})).toBe(false);
    expect(denOpen(DEN_OPENS_AT, {})).toBe(true);
    expect(denOpen(DEN_OPENS_AT - 50, { [DEN_MARKS.invited]: 1 }), 'deleting finished tasks never shuts it').toBe(true);
  });
});

describe('companionForm', () => {
  it('follows the evolution ladder', () => {
    expect(companionForm(9)).toBeNull();
    expect(companionForm(10)![1]).toBe('🥚');
    expect(companionForm(999)![1]).toBe('✨🐲');
    expect(companionForm(5000)![1]).toBe('👑🐲');
  });
});

describe('trinkets', () => {
  it('has unique ids, a spot for each, and every trinket says how to earn it', () => {
    const ids = TRINKETS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).not.toContain('none');
    for (const t of TRINKETS) {
      expect(t.label.length, t.id).toBeGreaterThan(0);
      expect(t.hint.length, t.id).toBeGreaterThan(0);
    }
  });

  it('counts only moments toward the scrapbook trinkets', () => {
    expect(momentsSeen({ 'moment:aurora': 1, 'moment:disco': 2, 'wear:balloon': 3, 'duel:wins': 4 })).toBe(2);
  });
});

describe('the outfit', () => {
  const DAY = '2026-11-03';
  const NOW = new Date('2026-11-03T12:00:00').getTime();
  const crowned = (marks: Record<string, number> = {}, unlocks: string[] = []): DenProgress =>
    ({ unlocks, marks, lifetime: 1000 });
  const ids = (o: ReturnType<typeof outfit>) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, v!.id]));

  it('wears the crown on a crowned companion until another hat replaces it', () => {
    expect(ids(outfit(crowned(), null, DAY, 4))).toEqual({ head: 'crown' });
    expect(ids(outfit(crowned({ 'wear:head:tophat': NOW, 'duel:wins': 1 }), null, DAY, 4))).toEqual({ head: 'tophat' });
    expect(ids(outfit(crowned({ 'wear:head:none': NOW }), null, DAY, 4)), 'a bare head is a choice too').toEqual({});
    expect(ids(outfit({ unlocks: [], marks: {}, lifetime: 999 }, null, DAY, 4)), 'no crown before it is earned').toEqual({});
  });

  it('wears one thing in every spot at once', () => {
    const marks = { 'wear:head:bow': NOW, 'wear:eyes:shades': NOW, 'wear:held:lantern': NOW, 'wear:float:balloon': NOW,
      'moment:a': 1, 'moment:b': 1, 'moment:c': 1, 'moment:d': 1, 'moment:e': 1 };
    expect(ids(outfit(crowned(marks, ['streak-7', 'night-owl']), null, DAY, 4)))
      .toEqual({ head: 'bow', eyes: 'shades', held: 'lantern', float: 'balloon' });
  });

  it('carries an outfit chosen before each spot had its own choice into that thing’s spot', () => {
    expect(ids(outfit(crowned({ 'wear:balloon': 5, 'wear:bow': 9 }, ['streak-7']), null, DAY, 4)))
      .toEqual({ head: 'bow' });
    expect(ids(outfit(crowned({ 'wear:balloon': 5, 'wear:none': 9 }), null, DAY, 4)), 'the old "none" leaves the crown on')
      .toEqual({ head: 'crown' });
    expect(ids(outfit(crowned({ 'wear:bow': 9, 'wear:head:crown': 10 }, ['streak-7']), null, DAY, 4)),
      'a choice in the spot itself outranks the old one').toEqual({ head: 'crown' });
  });

  it('never wears something unearned, even when it is the newest choice', () => {
    expect(ids(outfit(crowned({ 'wear:held:wand': NOW }), null, DAY, 4))).toEqual({ head: 'crown' });
  });

  it('puts the season’s costume on over anything chosen before the season began', () => {
    const before = new Date('2026-10-10T12:00:00').getTime();
    const o = outfit(crowned({ 'wear:held:lantern': before }, ['night-owl']), 'halloween', '2026-10-20', 4);
    expect(ids(o)).toEqual({ head: 'crown', held: costumeId('halloween') });
  });

  it('lets a choice made during the season win over the costume, or bring it back', () => {
    const during = new Date('2026-10-20T12:00:00').getTime();
    const lantern = outfit(crowned({ 'wear:held:lantern': during }, ['night-owl']), 'halloween', '2026-10-21', 4);
    expect(ids(lantern).held).toBe('lantern');
    const bare = outfit(crowned({ 'wear:held:none': during }), 'halloween', '2026-10-21', 4);
    expect(bare.held, 'taking the costume off sticks').toBeUndefined();
    const back = outfit(crowned({ 'wear:held:none': during, [`wear:held:${costumeId('halloween')}`]: during + 1 }), 'halloween', '2026-10-21', 4);
    expect(ids(back).held).toBe(costumeId('halloween'));
  });
});

describe('the scrapbook', () => {
  it('has a page for every moment, and nothing else', () => {
    expect(Object.keys(SCRAPBOOK).sort()).toEqual([...MOMENTS].sort());
    for (const m of MOMENTS) {
      expect(SCRAPBOOK[m].name.length, m).toBeGreaterThan(0);
      expect(SCRAPBOOK[m].hint.length, m).toBeGreaterThan(0);
    }
  });
});

describe('drawing the companion', () => {
  it('splits a form into the creature and what the form adds', () => {
    expect(splitForm('👑🐲')).toEqual({ adornment: '👑', creature: '🐲' });
    expect(splitForm('✨🐲')).toEqual({ adornment: '✨', creature: '🐲' });
    for (const [, form] of PET_STAGES) {
      const { adornment, creature } = splitForm(form);
      expect(adornment + creature, form).toBe(form);
      expect(creature.length, form).toBeGreaterThan(0);
    }
  });

  it('draws the crown from the outfit, as a trinket, never from the form', () => {
    expect(WEARABLE_ADORNMENTS.has(splitForm('👑🐲').adornment)).toBe(true);
    for (const a of WEARABLE_ADORNMENTS) expect(TRINKETS.some((t) => t.emoji === a), a).toBe(true);
  });
});
