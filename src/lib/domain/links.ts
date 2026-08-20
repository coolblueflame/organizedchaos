/**
 * URL detection for notes text (2026-08-20 ask: links in a todo's notes
 * should be tappable). Deliberately http(s)-only — a linkifier that accepts
 * arbitrary schemes is an invitation to javascript: mischief the moment any
 * synced text renders as markup.
 */

const URL_RE = /https?:\/\/[^\s<>"']+/g;

/**
 * Trailing punctuation belongs to the SENTENCE, not the URL: "see https://x.y."
 * ends a sentence, and "(https://x.y)" closes a bracket. A closing paren is
 * kept only while an opening one inside the URL leaves it unbalanced — the
 * Wikipedia-style "…/Foo_(bar)" survives, "(see …/Foo)" sheds the paren.
 */
function trimTrailing(url: string): string {
  let out = url;
  for (;;) {
    const last = out[out.length - 1]!;
    if ('.,;:!?\'"'.includes(last)) { out = out.slice(0, -1); continue; }
    if (last === ')') {
      const opens = (out.match(/\(/g) ?? []).length;
      const closes = (out.match(/\)/g) ?? []).length;
      if (closes > opens) { out = out.slice(0, -1); continue; }
    }
    break;
  }
  return out;
}

export interface LinkSegment { kind: 'text' | 'link'; text: string; href?: string }

/** Split text into plain and link segments, in order, nothing lost. */
export function linkifySegments(text: string): LinkSegment[] {
  const segments: LinkSegment[] = [];
  let cursor = 0;
  for (const match of text.matchAll(URL_RE)) {
    const raw = match[0];
    const url = trimTrailing(raw);
    const start = match.index!;
    if (start > cursor) segments.push({ kind: 'text', text: text.slice(cursor, start) });
    segments.push({ kind: 'link', text: url, href: url });
    cursor = start + url.length;
  }
  if (cursor < text.length) segments.push({ kind: 'text', text: text.slice(cursor) });
  return segments;
}

/** Unique URLs in order of first appearance — the chip row's input. */
export function extractUrls(text: string): string[] {
  return [...new Set(
    linkifySegments(text).filter((s) => s.kind === 'link').map((s) => s.href!),
  )];
}

/** "https://www.example.com/a/b?c" → "example.com" — a chip-sized label. */
export function linkLabel(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
