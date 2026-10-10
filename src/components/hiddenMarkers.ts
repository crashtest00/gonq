import { OPEN_COMMENT_LABEL, RESOLVED_COMMENT_LABEL, parseCommentMarkers } from '../comment-threads';

/**
 * The block editor with "Show markers in active block" off: each thread marker is
 * shown as its single glyph instead of its `[💬](#md-thread-…)` source. The marker
 * stays in the file; an edit made on the shortened text is applied to the real text.
 */

interface Span {
  from: number;
  to: number;
  glyph: string;
}

function spans(source: string): Span[] {
  return [...parseCommentMarkers(source).values()]
    .flat()
    .map((m) => ({ from: m.from, to: m.to, glyph: m.status === 'resolved' ? RESOLVED_COMMENT_LABEL : OPEN_COMMENT_LABEL }))
    .sort((a, b) => a.from - b.from);
}

/** `source` with every marker collapsed to its glyph. */
export function hideMarkers(source: string): string {
  let out = '';
  let at = 0;
  for (const s of spans(source)) {
    out += source.slice(at, s.from) + s.glyph;
    at = s.to;
  }
  return out + source.slice(at);
}

/** Where `shown` offset `i` (in the hidden view of `source`) falls in `source`. */
export function shownToSource(source: string, i: number): number {
  let delta = 0;
  for (const s of spans(source)) {
    const shownFrom = s.from - delta;
    if (i <= shownFrom) break;
    const shownTo = shownFrom + s.glyph.length;
    if (i < shownTo) return s.to; // inside a glyph: after the whole marker
    delta += s.to - s.from - s.glyph.length;
  }
  return i + delta;
}

/**
 * The new `source` after the user changed the hidden view from `hideMarkers(source)`
 * to `next`. The edit is recovered as a replacement of one range; a marker the range
 * touches goes with it, and one it only borders stays.
 */
export function editHidden(source: string, next: string): string {
  const prev = hideMarkers(source);
  let p = 0;
  const max = Math.min(prev.length, next.length);
  while (p < max && prev[p] === next[p]) p++;
  let s = 0;
  while (s < max - p && prev[prev.length - 1 - s] === next[next.length - 1 - s]) s++;
  const a = p;
  const b = prev.length - s;
  const inserted = next.slice(p, next.length - s);
  // Offsets at an edge belong to the text before (a) or after (b) so bordering markers survive.
  const from = a === b ? shownToSource(source, a) : startOf(source, a);
  const to = a === b ? from : endOf(source, b);
  return source.slice(0, from) + inserted + source.slice(to);
}

function startOf(source: string, i: number): number {
  let delta = 0;
  for (const s of spans(source)) {
    const shownFrom = s.from - delta;
    if (i <= shownFrom) break;
    if (i < shownFrom + s.glyph.length) return s.from;
    delta += s.to - s.from - s.glyph.length;
  }
  return i + delta;
}

function endOf(source: string, i: number): number {
  let delta = 0;
  for (const s of spans(source)) {
    const shownFrom = s.from - delta;
    if (i <= shownFrom) break;
    if (i <= shownFrom + s.glyph.length) return s.to;
    delta += s.to - s.from - s.glyph.length;
  }
  return i + delta;
}
