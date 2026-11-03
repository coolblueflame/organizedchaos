import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { recapitalize } from './recapitalize';

/** A stand-in field: just the parts recapitalize touches. */
function field(value = '') {
  return { value, setSelectionRange: vi.fn() } as unknown as HTMLInputElement & { setSelectionRange: ReturnType<typeof vi.fn> };
}

describe('recapitalize', () => {
  let frames: Array<() => void>;
  const flush = () => { const f = frames.shift(); f?.(); };

  beforeEach(() => {
    frames = [];
    vi.stubGlobal('requestAnimationFrame', (cb: () => void) => { frames.push(cb); return frames.length; });
    vi.stubGlobal('navigator', { maxTouchPoints: 5 });
  });
  afterEach(() => vi.unstubAllGlobals());

  it('puts a space in and takes it out again, a frame apart, ending empty with the caret at the start', () => {
    const el = field();
    vi.stubGlobal('document', { activeElement: el });
    recapitalize(el);
    expect(el.value).toBe('');
    flush();
    expect(el.value).toBe(' ');
    flush();
    expect(el.value).toBe('');
    expect(el.setSelectionRange).toHaveBeenLastCalledWith(0, 0);
  });

  it('never touches text the reader has started typing', () => {
    const el = field();
    vi.stubGlobal('document', { activeElement: el });
    recapitalize(el);
    flush();
    el.value = ' s'; // a keystroke landed between the two frames
    flush();
    expect(el.value).toBe(' s');
  });

  it('leaves a field alone once focus has moved on', () => {
    const el = field();
    vi.stubGlobal('document', { activeElement: null });
    recapitalize(el);
    flush();
    expect(el.value).toBe('');
    expect(frames).toHaveLength(0);
  });

  it('does nothing at all without a touch screen', () => {
    vi.stubGlobal('navigator', { maxTouchPoints: 0 });
    const el = field();
    vi.stubGlobal('document', { activeElement: el });
    recapitalize(el);
    expect(frames).toHaveLength(0);
  });
});
