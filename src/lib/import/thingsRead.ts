/**
 * Reads a Things 3 `main.sqlite` entirely in the browser via sql.js (WASM).
 * The wasm is lazy-loaded only when the import screen actually parses a file,
 * so the main bundle never pays for it.
 */
import type { Database, SqlJsStatic } from 'sql.js';
import type {
  ThingsAreaRow, ThingsChecklistRow, ThingsRows, ThingsTagRow, ThingsTaskRow, ThingsTaskTagRow,
} from './thingsMap';

function all<T>(db: Database, sql: string): T[] {
  const stmt = db.prepare(sql);
  const rows: T[] = [];
  try {
    while (stmt.step()) rows.push(stmt.getAsObject() as T);
  } finally {
    stmt.free();
  }
  return rows;
}

/** Core reader with an injected sql.js runtime (tests pass the node build). */
export function readThingsRows(SQL: SqlJsStatic, bytes: Uint8Array): ThingsRows {
  const db = new SQL.Database(bytes);
  try {
    return {
      tasks: all<ThingsTaskRow>(db, `
        SELECT uuid, type, status, trashed, title,
               notes, creationDate, userModificationDate, stopDate,
               start, startDate, deadline, area, project, heading,
               CAST(rt1_recurrenceRule AS TEXT) AS recurrenceRule,
               rt1_repeatingTemplate           AS repeatingTemplate,
               rt1_instanceCreationPaused      AS instanceCreationPaused
        FROM TMTask`),
      areas: all<ThingsAreaRow>(db, 'SELECT uuid, title FROM TMArea'),
      tags: all<ThingsTagRow>(db, 'SELECT uuid, title FROM TMTag'),
      taskTags: all<ThingsTaskTagRow>(db, 'SELECT tasks, tags FROM TMTaskTag'),
      checklistItems: all<ThingsChecklistRow>(db, 'SELECT uuid, task, title, status, "index" AS "index" FROM TMChecklistItem'),
    };
  } finally {
    db.close();
  }
}

/** Browser entry point — boots the WASM runtime on demand. */
export async function readThingsDb(bytes: Uint8Array): Promise<ThingsRows> {
  const [{ default: initSqlJs }, { default: wasmUrl }] = await Promise.all([
    import('sql.js'),
    import('sql.js/dist/sql-wasm.wasm?url'),
  ]);
  const SQL = await initSqlJs({ locateFile: () => wasmUrl });
  return readThingsRows(SQL, bytes);
}
