import { beforeEach, describe, expect, it } from 'vitest';
import { undoStack } from './undo.svelte';

beforeEach(() => undoStack.clear());

describe('UndoStack', () => {
  it('undoes the most recent action and pops it', async () => {
    const ran: string[] = [];
    undoStack.push('first', async () => void ran.push('first'));
    undoStack.push('second', async () => void ran.push('second'));

    expect(await undoStack.undo()).toBe('second');
    expect(await undoStack.undo()).toBe('first');
    expect(await undoStack.undo()).toBeNull();
    expect(ran).toEqual(['second', 'first']);
  });

  it('undoes the entry push() handed back, even though $state proxies the array', async () => {
    // Regression: reference equality fails across the proxy boundary, which
    // made the toast's Undo button a silent no-op.
    let ran = false;
    undoStack.push('older', async () => {});
    const entry = undoStack.push('mine', async () => { ran = true; });
    undoStack.push('newer', async () => {});

    expect(await undoStack.undoEntry(entry)).toBe('mine');
    expect(ran).toBe(true);
    expect(undoStack.entries.map((e) => e.label)).toEqual(['older', 'newer']);
  });

  it('undoing the same entry twice is harmless', async () => {
    let count = 0;
    const entry = undoStack.push('once', async () => { count += 1; });
    await undoStack.undoEntry(entry);
    expect(await undoStack.undoEntry(entry)).toBeNull();
    expect(count).toBe(1);
  });

  it('keeps the stack bounded', async () => {
    for (let i = 0; i < 20; i++) undoStack.push(`a${i}`, async () => {});
    expect(undoStack.entries.length).toBeLessThanOrEqual(12);
    expect(undoStack.latest?.label).toBe('a19');
  });
});
