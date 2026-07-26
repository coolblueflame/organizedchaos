import { beforeAll, describe, expect, it } from 'vitest';
import initSqlJs, { type SqlJsStatic } from 'sql.js';
import { readThingsRows } from './thingsRead';
import { mapThings } from './thingsMap';

/**
 * Builds a SYNTHETIC Things-schema database in memory — real personal data
 * never enters the repo. Schema mirrors the columns our queries touch.
 */
let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs(); // node build finds its wasm in node_modules
});

function syntheticDb(): Uint8Array {
  const db = new SQL.Database();
  db.run(`
    CREATE TABLE TMTask (
      uuid TEXT PRIMARY KEY, type INTEGER, status INTEGER, trashed INTEGER,
      title TEXT, notes TEXT, creationDate REAL, userModificationDate REAL,
      stopDate REAL, start INTEGER, startDate INTEGER, deadline INTEGER,
      area TEXT, project TEXT, heading TEXT,
      rt1_recurrenceRule BLOB, rt1_repeatingTemplate TEXT, rt1_instanceCreationPaused INTEGER
    );
    CREATE TABLE TMArea (uuid TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE TMTag (uuid TEXT PRIMARY KEY, title TEXT);
    CREATE TABLE TMTaskTag (tasks TEXT, tags TEXT);
    CREATE TABLE TMChecklistItem (uuid TEXT PRIMARY KEY, task TEXT, title TEXT, status INTEGER, "index" INTEGER);
  `);
  db.run("INSERT INTO TMArea VALUES ('A1', 'Life')");
  db.run(`INSERT INTO TMTask VALUES
    ('P1', 1, 0, 0, 'Garden', NULL, 700000000, 700000001, NULL, 1, NULL, NULL, 'A1', NULL, NULL, NULL, NULL, NULL),
    ('T1', 0, 0, 0, 'plant tomatoes', 'soon', 700000002, 700000003, NULL, 1, NULL, ${(2027 << 16) | (3 << 12) | (15 << 7)}, NULL, 'P1', NULL, NULL, NULL, NULL),
    ('T2', 0, 3, 0, 'buy seeds', NULL, 700000004, 700000005, 700000006, 1, NULL, NULL, NULL, 'P1', NULL, NULL, NULL, NULL)`);
  db.run("INSERT INTO TMTag VALUES ('G1', 'green')");
  db.run("INSERT INTO TMTaskTag VALUES ('T1', 'G1')");
  db.run("INSERT INTO TMChecklistItem VALUES ('C1', 'T1', 'dig holes', 0, 1)");
  const bytes = db.export();
  db.close();
  return bytes;
}

describe('readThingsRows → mapThings (full pipeline on a synthetic db)', () => {
  it('reads typed rows and the mapping produces the expected world', () => {
    const rows = readThingsRows(SQL, syntheticDb());
    expect(rows.tasks).toHaveLength(3);
    expect(rows.areas[0]).toEqual({ uuid: 'A1', title: 'Life' });

    const m = mapThings(rows);
    expect(m.lists.map((l) => l.title)).toEqual(['Garden']);
    expect(m.lists[0]!.areaGroup).toBe('Life');
    const open = m.tasks.find((t) => t.name === 'plant tomatoes')!;
    expect(open.deadline).toBe('2027-03-15');
    expect(open.notes).toBe('soon\n\n- [ ] dig holes');
    expect(open.tagIds).toEqual(['G1']);
    const done = m.tasks.find((t) => t.name === 'buy seeds')!;
    expect(done.completedAt).toBeGreaterThan(0);
    expect(m.counts).toMatchObject({ lists: 1, openTasks: 1, completedTasks: 1 });
  });
});
