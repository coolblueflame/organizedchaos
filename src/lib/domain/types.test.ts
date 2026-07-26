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
    expect(DEFAULT_SETTINGS).toEqual({
      hoursPerDay: 1, slackBandDays: 3, rolloverHour: 4, autoSelectNext: false,
    });
  });
});
