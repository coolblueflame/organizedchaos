import { describe, expect, it } from 'vitest';
import {
  FINDS_AT_OPENING, KEVIN_FINDS, KEVIN_MOVES, KEVIN_STILL, KEVIN_AFTER, VAULT_MARKS, VAULT_WEEK_PREFIX,
  collectionComplete, doorDrawn, holdingKey, vaultFinds, weekOf,
} from './vault';
import { TRINKETS } from './den';

const opened = { [VAULT_MARKS.opened]: 1 };
const weeks = (n: number) => Object.fromEntries(
  Array.from({ length: n }, (_, i) => [`${VAULT_WEEK_PREFIX}2026-11-${String(2 + i * 7).padStart(2, '0')}`, 1]),
);

describe('the little door and Kevin’s vault', () => {
  it('weeks start on Monday, from any day of the week, across a month edge', () => {
    expect(weekOf('2026-11-23')).toBe('2026-11-23'); // a Monday
    expect(weekOf('2026-11-29')).toBe('2026-11-23'); // the Sunday after
    expect(weekOf('2026-12-02')).toBe('2026-11-30');
    expect(weekOf('2027-01-01')).toBe('2026-12-28');
  });

  it('the door is drawn once the riddle hiding the key is solved, and wants that key held', () => {
    expect(doorDrawn({})).toBe(false);
    expect(doorDrawn({ 'riddle:keys': 1 })).toBe(true);
    expect(holdingKey({ held: { id: 'key', emoji: '🔑', slot: 'held' } })).toBe(true);
    expect(holdingKey({ held: { id: 'candle', emoji: '🕯️', slot: 'held' } })).toBe(false);
    expect(holdingKey({})).toBe(false);
    expect(TRINKETS.some((t) => t.id === 'key' && t.slot === 'held'), 'the key is something held').toBe(true);
  });

  it('the shelf is empty before the door opens, then grows one find per later week, up to the whole collection', () => {
    expect(vaultFinds({ ...weeks(3) })).toEqual([]);
    expect(vaultFinds(opened)).toHaveLength(FINDS_AT_OPENING);
    expect(vaultFinds({ ...opened, ...weeks(1) }), 'the opening week adds nothing').toHaveLength(FINDS_AT_OPENING);
    expect(vaultFinds({ ...opened, ...weeks(3) })).toHaveLength(FINDS_AT_OPENING + 2);
    expect(vaultFinds({ ...opened, ...weeks(40) })).toHaveLength(KEVIN_FINDS.length);
    expect(collectionComplete({ ...opened, ...weeks(40) })).toBe(true);
    expect(collectionComplete({ ...opened, ...weeks(3) })).toBe(false);
  });

  it('the prizes behind the door are earned by the door and the finished collection', () => {
    const progress = (marks: Record<string, number>) => ({ unlocks: [], marks, lifetime: 0 });
    const earned = (id: string, marks: Record<string, number>) => TRINKETS.find((t) => t.id === id)!.earned(progress(marks));
    expect(earned('idea-hat', {})).toBe(false);
    expect(earned('idea-hat', opened)).toBe(true);
    expect(earned('lint-bear', { ...opened, ...weeks(3) })).toBe(false);
    expect(earned('lint-bear', { ...opened, ...weeks(40) })).toBe(true);
  });

  it('copy has no em dashes', () => {
    const all = [...KEVIN_FINDS.map((f) => f.label), ...KEVIN_STILL, ...KEVIN_AFTER, KEVIN_MOVES];
    for (const line of all) expect(line).not.toContain('—');
  });
});
