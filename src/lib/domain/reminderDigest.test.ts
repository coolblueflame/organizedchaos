import { describe, expect, it } from 'vitest';
// The digest lives in tools/ so the data repo's Action can run it with bare
// node — tested from here so the app's gates still stand guard over it.
// @ts-expect-error — plain .mjs module without type declarations
import { buildDigest, localDayKey } from '../../../tools/reminders/digest.mjs';

const TODAY = '2026-07-30';

const task = (over: Record<string, unknown>) => ({
  id: 'x', listId: 'L1', name: 'thing', notes: '', tagIds: [], priority: 'medium',
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

describe('buildDigest', () => {
  it('is null when nothing is due — no push fires on a clear morning', () => {
    expect(buildDigest([
      task({ deadline: '2026-08-15' }),
      task({}),
      task({ deadline: '2026-07-01', completedAt: 5 }),
      task({ deadline: '2026-07-01', deleted: true }),
    ], [], TODAY)).toBeNull();
  });

  it('counts overdue and due-today separately, leading with the oldest', () => {
    const d = buildDigest([
      task({ deadline: TODAY, name: 'due now' }),
      task({ deadline: '2026-07-20', name: 'oldest debt' }),
      task({ deadline: '2026-07-28', name: 'newer debt' }),
    ], [], TODAY)!;
    expect(d.counts).toEqual({ overdue: 2, today: 1 });
    expect(d.body).toContain('2 overdue');
    expect(d.body).toContain('1 due today');
    expect(d.body).toContain('oldest debt');
    expect(d.title).toContain('🔥');
  });

  it('a purely due-today morning gets the sunnier title', () => {
    const d = buildDigest([task({ deadline: TODAY })], [], TODAY)!;
    expect(d.title).toContain('☀️');
  });

  it('archived lists are off the hook, like everywhere else', () => {
    const lists = [{ id: 'L1', archived: true }];
    expect(buildDigest([task({ deadline: '2026-07-01' })], lists, TODAY)).toBeNull();
  });
});

describe('localDayKey', () => {
  it('renders a timezone-local YYYY-MM-DD', () => {
    // 2026-07-31T03:00Z is still July 30 in Regina (UTC-6, no DST).
    expect(localDayKey(new Date('2026-07-31T03:00:00Z'), 'America/Regina')).toBe('2026-07-30');
    expect(localDayKey(new Date('2026-07-31T03:00:00Z'), 'Asia/Tokyo')).toBe('2026-07-31');
  });
});
