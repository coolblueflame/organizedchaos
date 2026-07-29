/**
 * Pure mapping from raw Things 3 rows to Organized Chaos entities (spec §9).
 * Schema knowledge verified against a real database 2026-07-26 — see the
 * Phase 7 plan for the field-by-field notes.
 *
 * ID CONVENTION: every emitted entity uses its Things uuid as BOTH `id` and
 * `thingsUuid`, and cross-references (listId, tagIds, recurrenceId) point at
 * Things uuids too. The store's importThings() remaps ids to app ids
 * (preserving them across re-imports) — this module stays pure.
 */
import type { List, RecurrenceMode, RecurrenceTemplate, Tag, Task } from '../domain/types';
import { describeRecurrence } from '../ui/recurrenceText';

// ── raw rows (mirror the SELECTs in thingsRead.ts) ─────────────────────────

export interface ThingsTaskRow {
  uuid: string;
  type: number;               // 0 to-do, 1 project, 2 heading
  status: number;             // 0 open, 2 canceled, 3 completed
  trashed: number;
  title: string;
  notes: string | null;
  creationDate: number | null;         // Cocoa seconds
  userModificationDate: number | null; // Cocoa seconds
  stopDate: number | null;             // Cocoa seconds
  start: number;              // 0 inbox, 1 anytime/today, 2 someday
  startDate: number | null;   // bit-packed
  deadline: number | null;    // bit-packed
  area: string | null;
  project: string | null;
  heading: string | null;
  recurrenceRule: string | null;       // XML plist text (present ⇒ this row is a template)
  repeatingTemplate: string | null;    // instance → its template's uuid
  instanceCreationPaused: number | null;
}

export interface ThingsAreaRow { uuid: string; title: string }
export interface ThingsTagRow { uuid: string; title: string }
export interface ThingsTaskTagRow { tasks: string; tags: string }
export interface ThingsChecklistRow { uuid: string; task: string; title: string; status: number; index: number }

export interface ThingsRows {
  tasks: ThingsTaskRow[];
  areas: ThingsAreaRow[];
  tags: ThingsTagRow[];
  taskTags: ThingsTaskTagRow[];
  checklistItems: ThingsChecklistRow[];
}

// ── decoders ───────────────────────────────────────────────────────────────

/** Things packs calendar dates as (year<<16)|(month<<12)|(day<<7). */
export function unpackThingsDate(v: number): string {
  const y = v >> 16;
  const m = (v >> 12) & 0xf;
  const d = (v >> 7) & 0x1f;
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

/**
 * A Things date column → unix ms.
 *
 * These are seconds, but WHICH epoch depends on the version that wrote the
 * library: older ones count from the Cocoa epoch (2001-01-01Z), newer ones use
 * plain unix time. Adding the Cocoa offset to a value that was already unix
 * throws every date 31 years into the future — which is not just cosmetic,
 * because `updatedAt` is the sync merge key, so rows stamped in 2050 cannot be
 * edited or deleted by anything happening today.
 *
 * The two are easy to tell apart rather than guess at. Every unix value since
 * 2001 is above 978,307,200, while a Cocoa value would have to pass 1e9 to mean
 * a date after 2032 — and these columns hold creation, modification and
 * completion times, which are all in the past. The threshold sits between those
 * ranges with decades of clearance on both sides.
 */
const ALREADY_UNIX_S = 1_100_000_000; // Cocoa: 2035-11 · unix: 2004-11

export function cocoaToMs(v: number): number {
  return Math.round((v >= ALREADY_UNIX_S ? v : v + 978_307_200) * 1000);
}

/**
 * Minimal XML-plist reader for the recurrence dicts — handles dict/array/
 * integer/real/string, which is everything Things uses there. DOM-free so it
 * runs identically in the browser and in node tests.
 */
export function parsePlistDict(xml: string): Record<string, unknown> {
  const tokens = [...xml.matchAll(/<(\/?)(dict|array|key|integer|real|string)>([^<]*)/g)];
  let i = 0;

  function value(): unknown {
    const t = tokens[i];
    if (!t) throw new Error('plist: unexpected end');
    const [, close, tag, text] = t;
    if (close) throw new Error(`plist: unexpected </${tag}>`);
    i++;
    if (tag === 'integer' || tag === 'real') { skipClose(tag); return Number(text); }
    if (tag === 'string') { skipClose(tag); return text; }
    if (tag === 'array') {
      const arr: unknown[] = [];
      while (tokens[i] && !(tokens[i]![1] && tokens[i]![2] === 'array')) arr.push(value());
      i++; // consume </array>
      return arr;
    }
    if (tag === 'dict') {
      const dict: Record<string, unknown> = {};
      while (tokens[i] && !(tokens[i]![1] && tokens[i]![2] === 'dict')) {
        const keyTok = tokens[i]!;
        if (keyTok[2] !== 'key') throw new Error('plist: expected <key>');
        const key = keyTok[3]!;
        i++;
        skipClose('key');
        dict[key] = value();
      }
      i++; // consume </dict>
      return dict;
    }
    throw new Error(`plist: unhandled <${tag}>`);
  }

  function skipClose(tag: string): void {
    if (tokens[i] && tokens[i]![1] && tokens[i]![2] === tag) i++;
  }

  while (tokens[i] && tokens[i]![2] !== 'dict') i++;
  return value() as Record<string, unknown>;
}

/** Old NSCalendarUnit values Things uses in `fu`. */
const FU = { YEAR: 4, MONTH: 8, DAY: 16, WEEK: 256 } as const;

export interface DecodedRecurrence {
  mode: RecurrenceMode;
  /** Present when the decode involved a guess the user should review. */
  note?: string;
}

export function decodeRecurrencePlist(xml: string): DecodedRecurrence {
  try {
    const d = parsePlistDict(xml);
    const fu = Number(d.fu ?? FU.DAY);
    const fa = Math.max(1, Number(d.fa ?? 1));
    const tp = Number(d.tp ?? 1);
    const of = Array.isArray(d.of) ? (d.of as Array<Record<string, unknown>>) : [];

    if (tp === 0) {
      const unit = fu === FU.WEEK ? 'weeks' : fu === FU.MONTH ? 'months' : 'days';
      const interval = fu === FU.YEAR ? fa * 12 : fa;
      return {
        mode: { kind: 'afterCompletion', interval, unit: fu === FU.YEAR ? 'months' : unit },
        note: fu === FU.YEAR ? 'was "yearly after completion" in Things — converted to months' : undefined,
      };
    }

    if (fu === FU.MONTH) {
      const dy = Number(of[0]?.dy ?? 1);
      const dayOfMonth = dy >= 1 && dy <= 31 ? dy : 31;
      return {
        mode: { kind: 'monthly', dayOfMonth },
        note: fa > 1 ? `was "every ${fa} months" in Things — now monthly` : undefined,
      };
    }
    if (fu === FU.WEEK) {
      // Apple weekday 1=Sunday…7=Saturday → JS getDay 0…6
      const weekdays = of
        .map((o) => Number(o.wd))
        .filter((wd) => wd >= 1 && wd <= 7)
        .map((wd) => wd - 1)
        .sort();
      if (weekdays.length === 0) return { mode: { kind: 'weekly', weekdays: [1] }, note: 'weekday could not be read — defaulted to Monday' };
      return {
        mode: { kind: 'weekly', weekdays },
        note: fa > 1 ? `was "every ${fa} weeks" in Things — now weekly` : undefined,
      };
    }
    if (fu === FU.DAY) {
      if (fa === 1) return { mode: { kind: 'weekly', weekdays: [0, 1, 2, 3, 4, 5, 6] }, note: 'was "daily" in Things' };
      return { mode: { kind: 'afterCompletion', interval: fa, unit: 'days' }, note: `was "every ${fa} days" in Things — now after-completion` };
    }
    if (fu === FU.YEAR) {
      const dy = Number(of[0]?.dy ?? 1);
      return {
        mode: { kind: 'monthly', dayOfMonth: dy >= 1 && dy <= 31 ? dy : 1 },
        note: 'was YEARLY in Things — our model has no yearly cadence; set to monthly, please adjust',
      };
    }
    return { mode: { kind: 'afterCompletion', interval: 7, unit: 'days' }, note: `unknown cadence (fu=${fu}) — defaulted` };
  } catch {
    return { mode: { kind: 'afterCompletion', interval: 7, unit: 'days' }, note: 'could not decode the Things repeat rule — defaulted to 7 days after completion' };
  }
}

// ── the mapping ────────────────────────────────────────────────────────────

export interface MappedImport {
  lists: List[];
  tags: Tag[];
  tasks: Task[];
  templates: RecurrenceTemplate[];
  review: Array<{ templateThingsUuid: string; message: string }>;
  counts: { lists: number; tags: number; openTasks: number; completedTasks: number; templates: number };
}

const INBOX_UUID = 'things-inbox';

export function mapThings(rows: ThingsRows): MappedImport {
  const stamp = (created: number | null, modified: number | null) => ({
    createdAt: created !== null ? cocoaToMs(created) : Date.now(),
    updatedAt: modified !== null ? cocoaToMs(modified) : created !== null ? cocoaToMs(created) : Date.now(),
    deleted: false as const,
  });

  const areaTitle = new Map(rows.areas.map((a) => [a.uuid, a.title]));
  const live = rows.tasks.filter((t) => !t.trashed);
  const projects = live.filter((t) => t.type === 1);
  const headings = live.filter((t) => t.type === 2);
  const todos = live.filter((t) => t.type === 0 && (t.status === 0 || t.status === 3));

  // Resolution needs ALL rows (even trashed) — a live task can point at a
  // trashed project/heading, and we must follow the chain to find a home.
  const anyByUuid = new Map(rows.tasks.map((t) => [t.uuid, t]));
  const liveProjectIds = new Set(projects.map((p) => p.uuid));

  /**
   * Where does this task live? Real Things shape: heading-parented tasks have
   * project=NULL and the heading row carries the project. Trashed projects
   * fall back to their area, then Inbox.
   */
  const resolveHome = (t: ThingsTaskRow): string => {
    let projectUuid = t.project;
    if (!projectUuid && t.heading) projectUuid = anyByUuid.get(t.heading)?.project ?? null;
    if (projectUuid) {
      if (liveProjectIds.has(projectUuid)) return projectUuid;
      const deadProject = anyByUuid.get(projectUuid);
      if (deadProject?.area) return deadProject.area;
      return INBOX_UUID;
    }
    return t.area ?? INBOX_UUID;
  };

  const homes = new Map(todos.map((t) => [t.uuid, resolveHome(t)]));

  // Lists: every live project; every area some task resolved into; Inbox if used.
  const lists: List[] = projects.map((p) => ({
    id: p.uuid, thingsUuid: p.uuid, title: p.title, sortMode: 'priority',
    areaGroup: p.area ? areaTitle.get(p.area) : undefined,
    ...stamp(p.creationDate, p.userModificationDate),
  }));
  /*
    Areas, the Inbox, and real Things tags carry NO modification date in the
    Things schema, so there is nothing honest to stamp them with. They used to
    get Date.now() — which made every RE-import "newer" than any local edit:
    recolored tags reshuffled, archived area lists came back, tombstones
    resurrected. A floor stamp of 1 means they exist on first import and then
    NEVER win against anything local (upsert only replaces on strictly-newer).
  */
  const FLOOR_STAMP = { createdAt: 1, updatedAt: 1, deleted: false } as const;
  const usedAreas = new Set([...homes.values()].filter((h) => areaTitle.has(h)));
  for (const areaUuid of usedAreas) {
    lists.push({
      id: areaUuid, thingsUuid: areaUuid, title: areaTitle.get(areaUuid)!,
      sortMode: 'priority', ...FLOOR_STAMP,
    });
  }
  if ([...homes.values()].includes(INBOX_UUID)) {
    lists.push({
      id: INBOX_UUID, thingsUuid: INBOX_UUID, title: 'Inbox', sortMode: 'priority', ...FLOOR_STAMP,
    });
  }

  // Tags: real Things tags + headings-as-tags (Ben's chosen mapping).
  let color = 0;
  const tags: Tag[] = [
    ...rows.tags.map((t) => ({
      id: t.uuid, thingsUuid: t.uuid, name: t.title, colorIndex: color++ % 16,
      ...FLOOR_STAMP,
    })),
    ...headings.map((h) => ({
      id: h.uuid, thingsUuid: h.uuid, name: h.title, colorIndex: color++ % 16,
      ...stamp(h.creationDate, h.userModificationDate),
    })),
  ];

  const tagsByTask = new Map<string, string[]>();
  for (const tt of rows.taskTags) {
    const bucket = tagsByTask.get(tt.tasks) ?? [];
    bucket.push(tt.tags);
    tagsByTask.set(tt.tasks, bucket);
  }

  const checklistByTask = new Map<string, ThingsChecklistRow[]>();
  for (const c of rows.checklistItems) {
    const bucket = checklistByTask.get(c.task) ?? [];
    bucket.push(c);
    checklistByTask.set(c.task, bucket);
  }

  const listRef = (t: ThingsTaskRow): string => homes.get(t.uuid) ?? INBOX_UUID;
  const emittedTagIds = new Set([...rows.tags.map((t) => t.uuid), ...headings.map((h) => h.uuid)]);
  const todayKey = new Date();
  const todayPacked = `${todayKey.getFullYear()}-${String(todayKey.getMonth() + 1).padStart(2, '0')}-${String(todayKey.getDate()).padStart(2, '0')}`;

  const priorityOf = (t: ThingsTaskRow): Task['priority'] => {
    if (t.start === 2) return 'someday';
    if (t.start === 1 && t.startDate !== null && unpackThingsDate(t.startDate) <= todayPacked) return 'high';
    return 'medium';
  };

  const notesWithChecklist = (t: ThingsTaskRow): string => {
    const items = (checklistByTask.get(t.uuid) ?? []).sort((a, b) => a.index - b.index);
    const base = t.notes ?? '';
    if (items.length === 0) return base;
    const md = items.map((c) => `- [${c.status === 3 ? 'x' : ' '}] ${c.title}`).join('\n');
    return base ? `${base}\n\n${md}` : md;
  };

  // Recurring templates (rows WITH a rule) become RecurrenceTemplates, not tasks.
  const templates: RecurrenceTemplate[] = [];
  const review: MappedImport['review'] = [];
  for (const r of todos.filter((t) => t.recurrenceRule !== null)) {
    const decoded = decodeRecurrencePlist(r.recurrenceRule!);
    templates.push({
      id: r.uuid, thingsUuid: r.uuid, listId: listRef(r), name: r.title,
      notes: notesWithChecklist(r), tagIds: tagsByTask.get(r.uuid) ?? [],
      priority: priorityOf(r), mode: decoded.mode,
      paused: r.instanceCreationPaused === 1,
      ...stamp(r.creationDate, r.userModificationDate),
    });
    review.push({
      templateThingsUuid: r.uuid,
      message: `"${r.title}" imported as: ${describeRecurrence(decoded.mode)}${decoded.note ? ` — ${decoded.note}` : ''}`,
    });
  }

  const tasks: Task[] = todos
    .filter((t) => t.recurrenceRule === null)
    .map((t) => ({
      id: t.uuid, thingsUuid: t.uuid, listId: listRef(t), name: t.title,
      notes: notesWithChecklist(t), priority: priorityOf(t),
      tagIds: [
        ...(tagsByTask.get(t.uuid) ?? []),
        ...(t.heading ? [t.heading] : []),
      ].filter((id) => emittedTagIds.has(id)),
      deadline: t.deadline !== null ? unpackThingsDate(t.deadline) : undefined,
      inProgress: false,
      completedAt: t.status === 3 && t.stopDate !== null ? cocoaToMs(t.stopDate) : undefined,
      // Open imports arrive untriaged — Things has no priority/estimate to carry
      // over, so each wants a once-over. Finished history needs nothing.
      needsReview: t.status === 3 ? undefined : true,
      // Finished-in-Things work is history, not this app's scoreboard. The
      // importer clears this when the user opts to count it.
      importedHistory: t.status === 3 ? true : undefined,
      recurrenceId: t.repeatingTemplate ?? undefined,
      ...stamp(t.creationDate, t.userModificationDate),
    }));

  return {
    lists, tags, tasks, templates, review,
    counts: {
      lists: lists.length,
      tags: tags.length,
      openTasks: tasks.filter((t) => t.completedAt === undefined).length,
      completedTasks: tasks.filter((t) => t.completedAt !== undefined).length,
      templates: templates.length,
    },
  };
}
