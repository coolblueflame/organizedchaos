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

describe('redo', () => {
  it('redoes what was just undone, and the entry is undoable again', async () => {
    const ran: string[] = [];
    undoStack.push('act', async () => void ran.push('undo'), async () => void ran.push('redo'));

    expect(await undoStack.undo()).toBe('act');
    expect(await undoStack.redo()).toBe('act');
    expect(await undoStack.undo()).toBe('act'); // the redo re-armed it
    expect(ran).toEqual(['undo', 'redo', 'undo']);
  });

  it('walks back through several undos in reverse order', async () => {
    const ran: string[] = [];
    undoStack.push('a', async () => {}, async () => void ran.push('a'));
    undoStack.push('b', async () => {}, async () => void ran.push('b'));
    await undoStack.undo(); // b
    await undoStack.undo(); // a

    expect(await undoStack.redo()).toBe('a');
    expect(await undoStack.redo()).toBe('b');
    expect(await undoStack.redo()).toBeNull();
    expect(ran).toEqual(['a', 'b']);
  });

  it('a fresh action forks history: the redo stack empties', async () => {
    undoStack.push('old', async () => {}, async () => {});
    await undoStack.undo();
    expect(undoStack.redoEntries.length).toBe(1);

    undoStack.push('new direction', async () => {}, async () => {});
    expect(await undoStack.redo()).toBeNull();
  });

  it('redoing does NOT fork history — the rest of the chain survives', async () => {
    undoStack.push('a', async () => {}, async () => {});
    undoStack.push('b', async () => {}, async () => {});
    await undoStack.undo(); // b
    await undoStack.undo(); // a

    await undoStack.redo(); // a — must not clear b from the redo stack
    expect(await undoStack.redo()).toBe('b');
  });

  it('undoing an entry with no redo closure breaks the chain honestly', async () => {
    // Shift+Z silently skipping it would redo something OLDER than what was
    // just undone — worse than admitting there is nothing to redo.
    undoStack.push('redoable', async () => {}, async () => {});
    undoStack.push('one-way', async () => {});
    await undoStack.undo(); // one-way
    expect(await undoStack.redo()).toBeNull();
  });

  it('the toast path (undoEntry) feeds the redo stack too', async () => {
    const ran: string[] = [];
    const entry = undoStack.push('via toast', async () => {}, async () => void ran.push('redo'));
    await undoStack.undoEntry(entry);

    expect(await undoStack.redo()).toBe('via toast');
    expect(ran).toEqual(['redo']);
  });
});

describe('failure and concurrency', () => {
  it('a throwing run() re-arms the entry and never arms a redo built on it', async () => {
    let attempts = 0;
    undoStack.push('flaky', async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('idb quota');
    }, async () => {});

    await expect(undoStack.undo()).rejects.toThrow('idb quota');
    // The failed undo never happened: still undoable, nothing to redo.
    expect(undoStack.entries.map((e) => e.label)).toEqual(['flaky']);
    expect(await undoStack.redo()).toBeNull();

    // And retrying works.
    expect(await undoStack.undo()).toBe('flaky');
    expect(await undoStack.redo()).toBe('flaky');
  });

  it('a throwing redo() keeps the entry redoable and off the undo stack', async () => {
    let attempts = 0;
    undoStack.push('act', async () => {}, async () => {
      attempts += 1;
      if (attempts === 1) throw new Error('offline');
    });
    await undoStack.undo();

    await expect(undoStack.redo()).rejects.toThrow('offline');
    expect(undoStack.entries.length).toBe(0);
    expect(undoStack.redoEntries.map((e) => e.label)).toEqual(['act']);

    expect(await undoStack.redo()).toBe('act');
    expect(undoStack.entries.map((e) => e.label)).toEqual(['act']);
  });

  it('a redo landing mid-undo waits its turn — the closures never interleave', async () => {
    const order: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    undoStack.push('slow', async () => {
      order.push('undo-start');
      await gate;
      order.push('undo-end');
    }, async () => {
      order.push('redo');
    });

    const undoing = undoStack.undo();
    const redoing = undoStack.redo(); // fired while the undo is still awaiting
    release();
    await Promise.all([undoing, redoing]);

    expect(order).toEqual(['undo-start', 'undo-end', 'redo']);
  });

  it('two fast Cmd+Z presses undo two different entries, not the same one', async () => {
    const ran: string[] = [];
    undoStack.push('a', async () => void ran.push('a'));
    undoStack.push('b', async () => void ran.push('b'));

    const [first, second] = await Promise.all([undoStack.undo(), undoStack.undo()]);
    expect([first, second]).toEqual(['b', 'a']);
    expect(ran).toEqual(['b', 'a']);
  });
});
