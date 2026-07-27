import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, type Priority, type Task } from './types';
import { searchTasks } from './search';

const now = new Date('2026-07-15T12:00:00');
const settings = { ...DEFAULT_SETTINGS };

let n = 0;
const task = (over: Partial<Task> & { priority: Priority }): Task => ({
  id: `t${n++}`, listId: 'L1', name: 'task', notes: '', tagIds: [],
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

const names = (ts: Task[]) => ts.map((t) => t.name);

describe('searchTasks', () => {
  it('is case-insensitive and searches notes as well as names', () => {
    const byName = task({ priority: 'low', name: 'Buy Milk' });
    const byNotes = task({ priority: 'low', name: 'groceries', notes: 'remember the MILK' });
    const miss = task({ priority: 'low', name: 'walk dog' });
    const res = searchTasks([byName, byNotes, miss], 'milk', settings, now);
    expect(names(res.open).sort()).toEqual(['Buy Milk', 'groceries']);
  });

  it('requires every term to match, in any order', () => {
    const hit = task({ priority: 'low', name: 'milk — buy some' });
    const partial = task({ priority: 'low', name: 'buy bread' });
    expect(names(searchTasks([hit, partial], 'buy milk', settings, now).open)).toEqual(['milk — buy some']);
  });

  it('splits open from completed and orders each usefully', () => {
    const lowOpen = task({ priority: 'low', name: 'milk low' });
    const maxOpen = task({ priority: 'max', name: 'milk max' });
    const older = task({ priority: 'low', name: 'milk older', completedAt: new Date('2026-07-01').getTime() });
    const newer = task({ priority: 'low', name: 'milk newer', completedAt: new Date('2026-07-10').getTime() });
    const res = searchTasks([lowOpen, older, maxOpen, newer], 'milk', settings, now);
    expect(names(res.open)).toEqual(['milk max', 'milk low']);       // priority desc
    expect(names(res.completed)).toEqual(['milk newer', 'milk older']); // most recent first
  });

  it('sorts equal priorities by soonest deadline, undated last', () => {
    const undated = task({ priority: 'medium', name: 'milk undated' });
    const late = task({ priority: 'medium', name: 'milk late', deadline: '2026-09-01' });
    const soon = task({ priority: 'medium', name: 'milk soon', deadline: '2026-08-01' });
    const res = searchTasks([undated, late, soon], 'milk', settings, now);
    expect(names(res.open)).toEqual(['milk soon', 'milk late', 'milk undated']);
  });

  it('ignores deleted tasks and blank queries', () => {
    const ghost = { ...task({ priority: 'low', name: 'milk ghost' }), deleted: true };
    const live = task({ priority: 'low', name: 'milk live' });
    expect(names(searchTasks([ghost, live], 'milk', settings, now).open)).toEqual(['milk live']);
    expect(searchTasks([live], '   ', settings, now)).toEqual({ open: [], completed: [], terms: [] });
  });
});
