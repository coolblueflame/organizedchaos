import { describe, expect, it } from 'vitest';
import { extractUrls, linkifySegments, linkLabel } from './links';

describe('linkifySegments', () => {
  it('splits text around urls, losing nothing', () => {
    const segs = linkifySegments('read https://a.io/x then https://b.io done');
    expect(segs).toEqual([
      { kind: 'text', text: 'read ' },
      { kind: 'link', text: 'https://a.io/x', href: 'https://a.io/x' },
      { kind: 'text', text: ' then ' },
      { kind: 'link', text: 'https://b.io', href: 'https://b.io' },
      { kind: 'text', text: ' done' },
    ]);
    expect(segs.map((s) => s.text).join('')).toBe('read https://a.io/x then https://b.io done');
  });

  it('sentence punctuation stays prose; balanced parens stay in the url', () => {
    expect(linkifySegments('see https://a.io/x.')[1]).toMatchObject({ href: 'https://a.io/x' });
    expect(linkifySegments('(see https://a.io/x)')[1]).toMatchObject({ href: 'https://a.io/x' });
    expect(linkifySegments('https://en.wikipedia.org/wiki/Dice_(game)')[0])
      .toMatchObject({ href: 'https://en.wikipedia.org/wiki/Dice_(game)' });
  });

  it('http(s) only — no other scheme ever becomes a link', () => {
    const segs = linkifySegments('javascript:alert(1) ftp://x file://y');
    expect(segs.every((s) => s.kind === 'text')).toBe(true);
  });

  it('plain text passes through as one segment', () => {
    expect(linkifySegments('no links here')).toEqual([{ kind: 'text', text: 'no links here' }]);
  });
});

describe('extractUrls / linkLabel', () => {
  it('dedupes, keeps first-appearance order, labels by bare hostname', () => {
    const urls = extractUrls('https://b.io/1 https://a.io https://b.io/1');
    expect(urls).toEqual(['https://b.io/1', 'https://a.io']);
    expect(linkLabel('https://www.example.com/deep/path?q=1')).toBe('example.com');
  });
});
