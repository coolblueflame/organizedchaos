import { describe, expect, it } from 'vitest';
import {
  appendChecklistItem, checklistItems, checklistProgress, removeChecklistLine,
  renameChecklistLine, toggleChecklistLine,
} from './checklist';

describe('checklistItems', () => {
  it('finds dash and star items, checked in any case, amid prose', () => {
    const notes = 'Trip prep.\n- [ ] socks\n* [x] charger\n  - [X] passport\nremember sunscreen';
    expect(checklistItems(notes)).toEqual([
      { line: 1, text: 'socks', done: false },
      { line: 2, text: 'charger', done: true },
      { line: 3, text: 'passport', done: true },
    ]);
  });

  it('ignores lookalikes that are not checkbox lines', () => {
    const notes = '-[ ] no space after dash\n- [] empty brackets\n[x] no bullet\n- [y] wrong mark';
    expect(checklistItems(notes)).toEqual([]);
  });

  it('empty text after the box is still an item (mid-typing)', () => {
    expect(checklistItems('- [ ] ')).toEqual([{ line: 0, text: '', done: false }]);
  });
});

describe('checklistProgress', () => {
  it('counts done over total, and is null with no checklist', () => {
    expect(checklistProgress('- [x] a\n- [ ] b\n- [ ] c')).toEqual({ done: 1, total: 3 });
    expect(checklistProgress('plain prose notes')).toBeNull();
    expect(checklistProgress('')).toBeNull();
  });
});

describe('toggleChecklistLine', () => {
  const notes = 'pack:\n- [ ] socks\n- [x] charger';

  it('checks and unchecks by absolute line, leaving everything else byte-identical', () => {
    expect(toggleChecklistLine(notes, 1)).toBe('pack:\n- [x] socks\n- [x] charger');
    expect(toggleChecklistLine(notes, 2)).toBe('pack:\n- [ ] socks\n- [ ] charger');
  });

  it('round-trips to the original text', () => {
    expect(toggleChecklistLine(toggleChecklistLine(notes, 1), 1)).toBe(notes);
  });

  it('refuses to touch a non-item line or a line out of range', () => {
    expect(toggleChecklistLine(notes, 0)).toBe(notes);
    expect(toggleChecklistLine(notes, 99)).toBe(notes);
  });

  it('preserves star bullets and indentation', () => {
    expect(toggleChecklistLine('  * [ ] nested', 0)).toBe('  * [x] nested');
  });
});

describe('renameChecklistLine + removeChecklistLine', () => {
  const notes = 'pack:\n- [x] socks\n- [ ] charger';

  it('renames in place, keeping the checked state and everything around it', () => {
    expect(renameChecklistLine(notes, 1, 'wool socks'))
      .toBe('pack:\n- [x] wool socks\n- [ ] charger');
  });

  it('refuses non-item lines', () => {
    expect(renameChecklistLine(notes, 0, 'nope')).toBe(notes);
    expect(removeChecklistLine(notes, 0)).toBe(notes);
  });

  it('removes exactly one item line', () => {
    expect(removeChecklistLine(notes, 2)).toBe('pack:\n- [x] socks');
    expect(removeChecklistLine('- [ ] only', 0)).toBe('');
  });
});

describe('appendChecklistItem', () => {
  it('starts the first item on empty notes', () => {
    expect(appendChecklistItem('')).toBe('- [ ] ');
  });

  it('adds on a fresh line after prose, absorbing trailing whitespace', () => {
    expect(appendChecklistItem('bring snacks')).toBe('bring snacks\n- [ ] ');
    expect(appendChecklistItem('bring snacks\n\n')).toBe('bring snacks\n- [ ] ');
  });

  it('chains items one per line', () => {
    expect(appendChecklistItem('- [ ] socks')).toBe('- [ ] socks\n- [ ] ');
  });

  it('never mutates an existing content line — an empty item keeps its trailing space', () => {
    expect(appendChecklistItem('- [ ] ')).toBe('- [ ] \n- [ ] ');
  });
});
