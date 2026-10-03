import { describe, expect, it } from 'vitest';
import {
  DEN_MARKS, DEN_OPENS_AT, SCRAPBOOK, TRINKETS, companionForm, denOpen, dressing, momentsSeen, splitForm, wornTrinket,
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
  const tophat = { 'duel:wins': 1 };

  it('wears whichever was put on most recently', () => {
    const marks = { ...tophat, 'wear:balloon': 100, 'wear:tophat': 200 };
    expect(wornTrinket({ unlocks: [], marks })!.id).toBe('tophat');
    expect(wornTrinket({ unlocks: [], marks: { ...marks, 'wear:balloon': 300 } })!.id).toBe('balloon');
  });

  it('wears nothing when taken off, or before anything was put on', () => {
    expect(wornTrinket({ unlocks: [], marks: { 'wear:balloon': 100, 'wear:none': 200 } })).toBeNull();
    expect(wornTrinket({ unlocks: [], marks: {} })).toBeNull();
  });

  it('never shows an unearned trinket, even when its stamp is newest', () => {
    // A stamp can arrive from a device whose unlocks have not synced here yet.
    expect(wornTrinket({ unlocks: [], marks: { 'wear:balloon': 100, 'wear:wand': 200 } })).toBeNull();
    expect(wornTrinket({ unlocks: ['streak-30'], marks: { 'wear:wand': 200 } })!.id).toBe('wand');
  });

  it('has unique ids, and every trinket says how to earn it', () => {
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

describe('the scrapbook', () => {
  it('has a page for every moment, and nothing else', () => {
    expect(Object.keys(SCRAPBOOK).sort()).toEqual([...MOMENTS].sort());
    for (const m of MOMENTS) {
      expect(SCRAPBOOK[m].name.length, m).toBeGreaterThan(0);
      expect(SCRAPBOOK[m].hint.length, m).toBeGreaterThan(0);
    }
  });
});

describe('dressing the companion', () => {
  it('wears things on the creature, never on what its form adds beside it', () => {
    expect(splitForm('👑🐲')).toEqual({ adornment: '👑', creature: '🐲' });
    expect(splitForm('✨🐲')).toEqual({ adornment: '✨', creature: '🐲' });
    for (const [, form] of PET_STAGES) {
      const { adornment, creature } = splitForm(form);
      expect(adornment + creature, form).toBe(form);
      expect(creature.length, form).toBeGreaterThan(0);
    }
  });

  it('puts the reader’s choice first, then the season’s costume, then nothing', () => {
    const bow = TRINKETS.find((t) => t.id === 'bow')!;
    expect(dressing(bow, 'halloween')).toEqual({ emoji: '🎀', slot: 'head' });
    expect(dressing(null, 'winter')).toEqual({ emoji: SEASON_LOOKS.winter.costume, slot: 'neck' });
    expect(dressing(null, null)).toBeNull();
  });
});
