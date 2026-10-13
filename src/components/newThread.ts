import { fencedCodeRanges, parseCommentMarkers } from '../comment-threads';

/** Where a new thread goes: a selection (its text becomes the anchor) or a bare cursor. */
export type ThreadTarget = { from: number; to: number } | number;

const ATX_HEADING = /^#{1,6}(\s|$)/;
const SETEXT_UNDERLINE = /^\s{0,3}(=+|-{2,})\s*$/;
const THEMATIC_BREAK = /^\s{0,3}([-*_])(\s*\1){2,}\s*$/;
const TABLE_DELIMITER = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;

/**
 * Whether a cursor at `offset` sits in a paragraph or list/task item: text a
 * marker can live in. Headings, code, tables, HTML and blank space are not.
 * A line-level reading of the source, which is all a bare caret has.
 */
export function isCommentableAt(text: string, offset: number): boolean {
  if (offset < 0 || offset > text.length) return false;
  if (fencedCodeRanges(text).some((r) => offset >= r.from && offset <= r.to)) return false;

  const start = text.lastIndexOf('\n', offset - 1) + 1;
  const nl = text.indexOf('\n', offset);
  const end = nl < 0 ? text.length : nl;
  const lineAt = (from: number, to: number) => text.slice(from, to).replace(/\r$/, '');
  const line = lineAt(start, end);
  if (line.trim() === '') return false;

  // The block: the run of non-blank lines around the cursor.
  const lines: string[] = [line];
  for (let at = start; at > 0; ) {
    const prevStart = text.lastIndexOf('\n', at - 2) + 1;
    const prev = lineAt(prevStart, at - 1);
    if (prev.trim() === '') break;
    lines.unshift(prev);
    at = prevStart;
  }
  for (let at = end + 1; at <= text.length; ) {
    const nextEnd = text.indexOf('\n', at);
    const next = lineAt(at, nextEnd < 0 ? text.length : nextEnd);
    if (next.trim() === '') break;
    lines.push(next);
    if (nextEnd < 0) break;
    at = nextEnd + 1;
  }

  const content = (l: string) => l.replace(/^\s{0,3}(>\s?)+/, '');
  const first = lines[0];
  if (/^( {4}|\t)/.test(first) && !/^\s*([-*+]|\d+[.)])\s/.test(first)) return false; // indented code
  if (/^\s{0,3}<[!?/a-zA-Z]/.test(first)) return false; // HTML block
  if (ATX_HEADING.test(content(line).trim()) || THEMATIC_BREAK.test(content(line))) return false;
  if (lines.length > 1 && SETEXT_UNDERLINE.test(lines[lines.length - 1])) return false;
  if (lines.length > 1 && lines[1].includes('-') && TABLE_DELIMITER.test(lines[1]) && lines.some((l) => l.includes('|'))) {
    return false; // table
  }
  return true;
}

const LIST_ITEM_START = /^\s*([-*+]|\d+[.)])\s/;

/**
 * The range a selection may anchor a thread to, or null: it must be non-blank, inside one
 * paragraph or list/task item (no blank line, no second item, nothing but commentable text at
 * either end), and not touch a thread marker.
 */
export function selectionRange(text: string, from: number, to: number): { from: number; to: number } | null {
  if (to <= from || to > text.length) return null;
  const slice = text.slice(from, to);
  if (slice.trim() === '' || /\n[ \t]*\r?\n/.test(slice) || parseCommentMarkers(slice).size > 0) return null;
  if (slice.split('\n').slice(1).some((l) => LIST_ITEM_START.test(l))) return null;
  for (const m of [...parseCommentMarkers(text).values()].flat()) if (from < m.to && to > m.from) return null;
  if (!isCommentableAt(text, from) || !isCommentableAt(text, to)) return null;
  return { from, to };
}
