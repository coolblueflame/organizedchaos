/**
 * A small stack of reversible actions. Anything consequential the user does —
 * completing, deleting, snoozing — pushes an entry here, so a misfire is
 * always one Cmd/Ctrl+Z (or one toast tap) away from being put back.
 *
 * Session-only by design: undo is for "oops, just now", not history rewriting.
 */
export interface UndoEntry {
  /**
   * Identity is by id, never by object reference: `$state` deep-proxies this
   * array, so the object handed back by push() is NOT reference-equal to the
   * proxied element stored inside it. (Comparing references made the toast's
   * Undo button silently no-op while keyboard undo worked.)
   */
  id: string;
  label: string;
  at: number;
  run: () => Promise<void>;
}

const DEPTH = 12;
let seq = 0;

class UndoStack {
  entries = $state<UndoEntry[]>([]);

  push(label: string, run: () => Promise<void>): UndoEntry {
    const entry: UndoEntry = { id: `u${++seq}`, label, at: Date.now(), run };
    this.entries = [...this.entries, entry].slice(-DEPTH);
    return entry;
  }

  get latest(): UndoEntry | null {
    return this.entries[this.entries.length - 1] ?? null;
  }

  /** Undo the most recent action; returns its label, or null if nothing to undo. */
  async undo(): Promise<string | null> {
    const entry = this.latest;
    return entry ? this.undoEntry(entry) : null;
  }

  /** Undo one specific action (the toast targets its own entry, not just the newest). */
  async undoEntry(target: UndoEntry | string): Promise<string | null> {
    const id = typeof target === 'string' ? target : target.id;
    const i = this.entries.findIndex((e) => e.id === id);
    if (i === -1) return null;
    const entry = this.entries[i]!;
    this.entries = [...this.entries.slice(0, i), ...this.entries.slice(i + 1)];
    await entry.run();
    return entry.label;
  }

  clear(): void {
    this.entries = [];
  }
}

export const undoStack = new UndoStack();
