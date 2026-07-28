import { describe, expect, it } from 'vitest';
import { duplicateGroups, sortByUsage, tagKey, tagUsage } from './tags';
import type { Tag, Task } from './types';

let n = 0;
const tag = (name: string, id = `tag${n++}`): Tag =>
  ({ id, name, colorIndex: 0, createdAt: 0, updatedAt: 0, deleted: false });

const task = (tagIds: string[], over: Partial<Task> = {}): Task => ({
  id: `t${n++}`, listId: 'L1', name: 'x', notes: '', tagIds, priority: 'medium',
  inProgress: false, createdAt: 0, updatedAt: 0, deleted: false, ...over,
});

describe('tagUsage', () => {
  it('counts open and completed separately', () => {
    const work = tag('work', 'W');
    const usage = tagUsage([work], [
      task(['W']),
      task(['W'], { completedAt: 1 }),
      task(['W'], { completedAt: 2 }),
    ]);
    expect(usage.get('W')).toEqual({ open: 1, completed: 2, total: 3 });
  });

  it('ignores deleted tasks, so a prunable tag reads as prunable', () => {
    const usage = tagUsage([tag('work', 'W')], [task(['W'], { deleted: true })]);
    expect(usage.get('W')!.total).toBe(0);
  });

  it('reports zero for a tag nothing wears', () => {
    expect(tagUsage([tag('orphan', 'O')], []).get('O')).toEqual({ open: 0, completed: 0, total: 0 });
  });

  it('ignores ids that no longer name a tag', () => {
    const usage = tagUsage([tag('work', 'W')], [task(['W', 'deleted-long-ago'])]);
    expect(usage.size).toBe(1);
    expect(usage.get('W')!.total).toBe(1);
  });
});

describe('duplicate detection', () => {
  it('treats case and stray whitespace as the same tag', () => {
    expect(tagKey('  Work ')).toBe(tagKey('work'));
    expect(tagKey('side  project')).toBe('side project');
  });

  it('keeps genuinely different names apart', () => {
    expect(tagKey('work')).not.toBe(tagKey('works'));
  });

  it('groups the spellings of one tag, busiest first', () => {
    const tags = [tag('work', 'A'), tag('Work', 'B'), tag('errands', 'C')];
    const usage = tagUsage(tags, [task(['B']), task(['B']), task(['A'])]);
    const groups = duplicateGroups(tags, usage);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.map((t) => t.id), 'the one carrying most tasks leads').toEqual(['B', 'A']);
  });

  it('says nothing about tags that are unique', () => {
    const tags = [tag('work', 'A'), tag('errands', 'C')];
    expect(duplicateGroups(tags, tagUsage(tags, []))).toEqual([]);
  });

  it('does not pair up blank names', () => {
    const tags = [tag('', 'A'), tag('   ', 'B')];
    expect(duplicateGroups(tags, tagUsage(tags, []))).toEqual([]);
  });
});

describe('sortByUsage', () => {
  it('puts the busiest first and breaks ties by name, ignoring case', () => {
    const tags = [tag('zebra', 'Z'), tag('Apple', 'A'), tag('busy', 'B')];
    const usage = tagUsage(tags, [task(['B']), task(['B'])]);
    expect(sortByUsage(tags, usage).map((t) => t.id)).toEqual(['B', 'A', 'Z']);
  });
});
