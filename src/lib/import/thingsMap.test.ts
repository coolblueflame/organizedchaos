import { describe, expect, it } from 'vitest';
import {
  cocoaToMs, decodeRecurrencePlist, mapThings, parsePlistDict, unpackThingsDate,
  type ThingsRows,
} from './thingsMap';

/** 2018-07-20 encoded the way the real DB does it: (y<<16)|(m<<12)|(d<<7). */
const PACKED_2018_07_20 = (2018 << 16) | (7 << 12) | (20 << 7);

const plist = (body: string) =>
  `<?xml version="1.0" encoding="UTF-8"?>\n<plist version="1.0">\n<dict>${body}</dict>\n</plist>`;

const MONTHLY_20TH = plist(
  '<key>fa</key><integer>1</integer><key>fu</key><integer>8</integer>' +
  '<key>of</key><array><dict><key>dy</key><integer>20</integer></dict></array>' +
  '<key>tp</key><integer>1</integer>',
);

const emptyRows = (): ThingsRows => ({
  tasks: [], areas: [], tags: [], taskTags: [], checklistItems: [],
});

const baseTask = {
  uuid: 'T1', type: 0, status: 0, trashed: 0, title: 'a task', notes: '',
  creationDate: 500, userModificationDate: 600, stopDate: null,
  start: 1, startDate: null, deadline: null,
  area: null, project: null, heading: null,
  recurrenceRule: null, repeatingTemplate: null, instanceCreationPaused: null,
};

describe('decoders', () => {
  it('unpacks bit-packed dates', () => {
    expect(unpackThingsDate(PACKED_2018_07_20)).toBe('2018-07-20');
  });

  it('converts Cocoa seconds to unix ms', () => {
    expect(cocoaToMs(0)).toBe(978307200000); // 2001-01-01T00:00:00Z
  });

  it('leaves a column that is ALREADY unix seconds alone', () => {
    // Ben's library (2026-07-28): every imported row landed 31 years in the
    // future because these columns were unix already and got the Cocoa offset
    // added on top. `updatedAt` is the sync merge key, so those rows could not
    // be edited or deleted — a tombstone stamped today lost to a row claiming
    // 2053. Whichever epoch a library uses, the answer must be the real date.
    const realDate = Date.UTC(2019, 9, 30);
    expect(cocoaToMs(realDate / 1000)).toBe(realDate);
  });

  it('reads both epochs as the same instant', () => {
    const instant = Date.UTC(2020, 0, 15);
    expect(cocoaToMs(instant / 1000)).toBe(instant); // unix seconds
    expect(cocoaToMs(instant / 1000 - 978_307_200)).toBe(instant); // cocoa seconds
  });

  it('parses a plist dict with nested arrays', () => {
    const d = parsePlistDict(MONTHLY_20TH);
    expect(d.fu).toBe(8);
    expect(d.fa).toBe(1);
    expect((d.of as Array<Record<string, unknown>>)[0]!.dy).toBe(20);
  });

  it('decodes monthly / weekly / after-completion cadences', () => {
    expect(decodeRecurrencePlist(MONTHLY_20TH).mode)
      .toEqual({ kind: 'monthly', dayOfMonth: 20 });
    const weekly = plist(
      '<key>fa</key><integer>1</integer><key>fu</key><integer>256</integer>' +
      '<key>of</key><array><dict><key>wd</key><integer>2</integer></dict>' +
      '<dict><key>wd</key><integer>6</integer></dict></array><key>tp</key><integer>1</integer>');
    // Apple weekday 1=Sunday … 7=Saturday → JS getDay 0…6
    expect(decodeRecurrencePlist(weekly).mode)
      .toEqual({ kind: 'weekly', weekdays: [1, 5] });
    const after = plist('<key>fa</key><integer>3</integer><key>fu</key><integer>16</integer><key>tp</key><integer>0</integer>');
    expect(decodeRecurrencePlist(after).mode)
      .toEqual({ kind: 'afterCompletion', interval: 3, unit: 'days' });
  });

  it('falls back safely on garbage', () => {
    const res = decodeRecurrencePlist('not a plist at all');
    expect(res.mode).toEqual({ kind: 'afterCompletion', interval: 7, unit: 'days' });
    expect(res.note).toMatch(/could not decode/i);
  });

  it('tokenizes self-closing tags instead of skipping past them', () => {
    // An empty <array/> used to vanish from the token stream entirely, so the
    // parser consumed the NEXT element as this key's value — every key after
    // it read the wrong data.
    const d = parsePlistDict(plist(
      '<key>of</key><array/><key>fa</key><integer>2</integer><key>empty</key><dict/>'));
    expect(d.of).toEqual([]);
    expect(d.fa).toBe(2);
    expect(d.empty).toEqual({});
  });

  it('flags monthly-by-weekday rules for review instead of guessing silently', () => {
    // "Monthly on the 3rd Tuesday": an `of` dict with wd but no dy.
    const byWeekday = plist(
      '<key>fa</key><integer>1</integer><key>fu</key><integer>8</integer>' +
      '<key>of</key><array><dict><key>wd</key><integer>3</integer></dict></array>' +
      '<key>tp</key><integer>1</integer>');
    const res = decodeRecurrencePlist(byWeekday);
    expect(res.mode).toEqual({ kind: 'monthly', dayOfMonth: 1 });
    expect(res.note).toMatch(/monthly by weekday/i);
  });

  it('flags count-from-the-end monthly rules when clamping to the 31st', () => {
    const lastDay = plist(
      '<key>fa</key><integer>1</integer><key>fu</key><integer>8</integer>' +
      '<key>of</key><array><dict><key>dy</key><integer>-1</integer></dict></array>' +
      '<key>tp</key><integer>1</integer>');
    const res = decodeRecurrencePlist(lastDay);
    expect(res.mode).toEqual({ kind: 'monthly', dayOfMonth: 31 });
    expect(res.note).toMatch(/counting from the end/i);
  });
});

describe('mapThings', () => {
  it('maps projects to lists with area grouping, and loose area tasks to area lists', () => {
    const rows = emptyRows();
    rows.areas = [{ uuid: 'A1', title: 'Work' }];
    rows.tasks = [
      { ...baseTask, uuid: 'P1', type: 1, title: 'Big Project', area: 'A1' },
      { ...baseTask, uuid: 'T1', title: 'in project', project: 'P1' },
      { ...baseTask, uuid: 'T2', title: 'loose in area', area: 'A1' },
      { ...baseTask, uuid: 'T3', title: 'inbox floater', start: 0 },
    ];
    const m = mapThings(rows);
    const listTitles = m.lists.map((l) => `${l.title}${l.areaGroup ? `@${l.areaGroup}` : ''}`).sort();
    expect(listTitles).toEqual(['Big Project@Work', 'Inbox', 'Work']);
    const inProject = m.tasks.find((t) => t.name === 'in project')!;
    expect(inProject.listId).toBe('P1'); // refs stay thingsUuids; the store remaps
    expect(m.tasks.find((t) => t.name === 'loose in area')!.listId).toBe('A1');
    expect(m.tasks.find((t) => t.name === 'inbox floater')!.listId).toBe('things-inbox');
  });

  it('maps priorities from start/startDate, deadlines, and logbook completion', () => {
    const rows = emptyRows();
    rows.tasks = [
      { ...baseTask, uuid: 'T1', title: 'today-ish', start: 1, startDate: PACKED_2018_07_20 },
      { ...baseTask, uuid: 'T2', title: 'someday', start: 2 },
      { ...baseTask, uuid: 'T3', title: 'anytime' },
      { ...baseTask, uuid: 'T4', title: 'deadlined', deadline: PACKED_2018_07_20 },
      { ...baseTask, uuid: 'T5', title: 'done', status: 3, stopDate: 700 },
      { ...baseTask, uuid: 'T6', title: 'canceled', status: 2, stopDate: 700 },
      { ...baseTask, uuid: 'T7', title: 'trashed', trashed: 1 },
    ];
    const m = mapThings(rows);
    const byName = (n: string) => m.tasks.find((t) => t.name === n);
    expect(byName('today-ish')!.priority).toBe('high'); // startDate long past → was in Today
    expect(byName('someday')!.priority).toBe('someday');
    expect(byName('anytime')!.priority).toBe('medium');
    expect(byName('deadlined')!.deadline).toBe('2018-07-20');
    expect(byName('done')!.completedAt).toBe(cocoaToMs(700));
    expect(byName('anytime')!.needsReview).toBe(true);      // open imports want a once-over
    expect(byName('done')!.needsReview).toBeUndefined();    // finished history does not
    expect(byName('canceled')).toBeUndefined();
    expect(byName('trashed')).toBeUndefined();
    expect(m.counts.completedTasks).toBe(1);
    expect(byName('today-ish')!.createdAt).toBe(cocoaToMs(500));
  });

  it('turns headings and TMTags into tags on their tasks; checklists become markdown', () => {
    const rows = emptyRows();
    rows.tags = [{ uuid: 'G1', title: 'errands' }];
    rows.taskTags = [{ tasks: 'T1', tags: 'G1' }];
    rows.tasks = [
      { ...baseTask, uuid: 'P1', type: 1, title: 'Proj' },
      { ...baseTask, uuid: 'H1', type: 2, title: 'Phase One', project: 'P1' },
      { ...baseTask, uuid: 'T1', title: 'tagged + headed', project: 'P1', heading: 'H1', notes: 'note text' },
    ];
    rows.checklistItems = [
      { uuid: 'C2', task: 'T1', title: 'second', status: 0, index: 2 },
      { uuid: 'C1', task: 'T1', title: 'first done', status: 3, index: 1 },
    ];
    const m = mapThings(rows);
    expect(m.tags.map((t) => t.name).sort()).toEqual(['Phase One', 'errands']);
    const task = m.tasks.find((t) => t.name === 'tagged + headed')!;
    expect(task.tagIds.sort()).toEqual(['G1', 'H1']);
    expect(task.notes).toBe('note text\n\n- [x] first done\n- [ ] second');
  });

  it('resolves heading-parented tasks to the heading’s project, and trashed-project refs to area/inbox', () => {
    const rows = emptyRows();
    rows.areas = [{ uuid: 'A1', title: 'Work' }];
    rows.tasks = [
      { ...baseTask, uuid: 'P1', type: 1, title: 'Live Project' },
      { ...baseTask, uuid: 'H1', type: 2, title: 'Milestone', project: 'P1' },
      { ...baseTask, uuid: 'T1', title: 'under heading', heading: 'H1' }, // project NULL — real Things shape
      { ...baseTask, uuid: 'P2', type: 1, title: 'Dead Project', trashed: 1, area: 'A1' },
      { ...baseTask, uuid: 'T2', title: 'orphan of dead project', project: 'P2' },
      { ...baseTask, uuid: 'P3', type: 1, title: 'Dead No Area', trashed: 1 },
      { ...baseTask, uuid: 'T3', title: 'fully orphaned', project: 'P3' },
    ];
    const m = mapThings(rows);
    expect(m.tasks.find((t) => t.name === 'under heading')!.listId).toBe('P1');
    expect(m.tasks.find((t) => t.name === 'orphan of dead project')!.listId).toBe('A1');
    expect(m.tasks.find((t) => t.name === 'fully orphaned')!.listId).toBe('things-inbox');
    const listIds = new Set(m.lists.map((l) => l.id));
    for (const t of m.tasks) expect(listIds.has(t.listId)).toBe(true);
  });

  it('recurring rows become templates (not tasks) with review notes; instances link back', () => {
    const rows = emptyRows();
    rows.tasks = [
      { ...baseTask, uuid: 'P1', type: 1, title: 'Proj' },
      { ...baseTask, uuid: 'R1', title: 'water plants', project: 'P1', recurrenceRule: MONTHLY_20TH, instanceCreationPaused: 1 },
      { ...baseTask, uuid: 'I1', title: 'water plants', project: 'P1', repeatingTemplate: 'R1' },
    ];
    const m = mapThings(rows);
    expect(m.tasks.map((t) => t.name)).toEqual(['water plants']); // just the instance
    expect(m.tasks[0]!.recurrenceId).toBe('R1');
    expect(m.templates).toHaveLength(1);
    expect(m.templates[0]!.mode).toEqual({ kind: 'monthly', dayOfMonth: 20 });
    expect(m.templates[0]!.paused).toBe(true);
    expect(m.review).toHaveLength(1);
    expect(m.review[0]!.templateThingsUuid).toBe('R1');
  });
});
