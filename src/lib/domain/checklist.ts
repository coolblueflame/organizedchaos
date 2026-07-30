/**
 * Checklists that live INSIDE a task's notes as markdown ("- [ ] socks"),
 * rendered interactive wherever notes are shown (2026-07-30 request).
 *
 * Deliberately not a schema field: the notes text IS the storage. That means
 * zero new sync surface (text already merges), the textarea stays the
 * power-editing tool, and every checklist imported from Things — which the
 * importer already flattened into exactly this markup — becomes tappable
 * retroactively. A checklist item is a line of the parent task, not a task:
 * it carries no priority, no deadline, never enters the draw, and ticking one
 * records nothing in history. "Pack for the trip" is the task; "socks" is a
 * checkbox.
 */

export interface ChecklistItem {
  /** Absolute line index in the notes — the toggle's unambiguous address. */
  line: number;
  text: string;
  done: boolean;
}

/** "- [ ] thing" / "* [x] thing", with optional leading indentation. */
const ITEM_RE = /^(\s*[-*] \[)([ xX])(\] ?)(.*)$/;

export function checklistItems(notes: string): ChecklistItem[] {
  const out: ChecklistItem[] = [];
  const lines = notes.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const m = ITEM_RE.exec(lines[i]!);
    if (m) out.push({ line: i, text: m[4]!, done: m[2] !== ' ' });
  }
  return out;
}

/** {done, total}, or null when the notes hold no checklist at all. */
export function checklistProgress(notes: string): { done: number; total: number } | null {
  const items = checklistItems(notes);
  if (items.length === 0) return null;
  return { done: items.filter((i) => i.done).length, total: items.length };
}

/** Flip one item by its line index; any other line comes back untouched. */
export function toggleChecklistLine(notes: string, line: number): string {
  const lines = notes.split('\n');
  const m = lines[line] !== undefined ? ITEM_RE.exec(lines[line]!) : null;
  if (!m) return notes;
  lines[line] = `${m[1]}${m[2] === ' ' ? 'x' : ' '}${m[3]}${m[4]}`;
  return lines.join('\n');
}

/**
 * Start a fresh unchecked item on its own line, ready to type into — the
 * button behind which the markup hides so nobody has to remember it.
 */
/** Replace one item's text, keeping its bullet, indentation and checked state. */
export function renameChecklistLine(notes: string, line: number, text: string): string {
  const lines = notes.split('\n');
  const m = lines[line] !== undefined ? ITEM_RE.exec(lines[line]!) : null;
  if (!m) return notes;
  lines[line] = `${m[1]}${m[2]}] ${text}`;
  return lines.join('\n');
}

/** Drop one item line entirely (saving an empty rename deletes the item). */
export function removeChecklistLine(notes: string, line: number): string {
  const lines = notes.split('\n');
  if (lines[line] === undefined || !ITEM_RE.test(lines[line]!)) return notes;
  lines.splice(line, 1);
  return lines.join('\n');
}

export function appendChecklistItem(notes: string): string {
  // Strip only trailing BLANK LINES — a content line keeps its exact bytes,
  // including the trailing space of a just-started empty item.
  const body = notes.replace(/\n[\s\n]*$/, '');
  return body.trim().length === 0 ? '- [ ] ' : `${body}\n- [ ] `;
}
