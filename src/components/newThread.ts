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

/** Source ranges of one rendered text node, as `[from, to, exact]` (exact: the rendered text is the source text). */
export type Segment = [from: number, to: number, exact: 0 | 1];

const TEXT_BLOCKS = 'p, li, h1, h2, h3, h4, h5, h6, pre, td, th';

function elementOf(node: Node | null): Element | null {
  return node instanceof Element ? node : (node?.parentElement ?? null);
}

/** The nearest paragraph or list item around a node, or null for anything else (headings, code, tables). */
function textBlockOf(node: Node | null): HTMLElement | null {
  const el = elementOf(node)?.closest(TEXT_BLOCKS);
  return el instanceof HTMLElement && (el.tagName === 'P' || el.tagName === 'LI') && el.dataset.segs !== undefined ? el : null;
}

function offsetIn(seg: Segment, at: number, length: number, side: 'start' | 'end'): number {
  if (seg[2] === 1) return seg[0] + at;
  // Rendered text that is not the source text (escapes, code) cannot be cut part-way: widen to the whole node.
  if (at <= 0) return seg[0];
  if (at >= length) return seg[1];
  return side === 'start' ? seg[0] : seg[1];
}

/**
 * The file range a browser selection covers, or null when it is not a valid
 * place for a thread: empty, spanning blocks, outside a paragraph or task item,
 * or touching a thread marker. `text` is the file text the view was rendered from.
 */
export function selectionToRange(root: Element, selection: Selection | null, text: string): { from: number; to: number } | null {
  if (!selection || selection.rangeCount === 0 || selection.isCollapsed) return null;
  const range = selection.getRangeAt(0);
  if (!root.contains(range.commonAncestorContainer)) return null;

  const block = textBlockOf(range.startContainer);
  if (block === null) return null;
  let working = range;
  if (!block.contains(range.endContainer)) {
    // Triple-click ends at the start of the next block: only an empty tail may be dropped.
    const tail = range.cloneRange();
    tail.setStartAfter(block);
    if (tail.toString().trim() !== '') return null;
    working = range.cloneRange();
    working.setEnd(block, block.childNodes.length);
  } else if (textBlockOf(range.endContainer) !== block) {
    return null;
  }

  for (const marker of Array.from(block.querySelectorAll('.gonq-marker'))) {
    if (working.intersectsNode(marker)) return null;
  }

  const segs: Segment[] = JSON.parse(block.dataset.segs ?? '[]');
  const nodes: Text[] = [];
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) nodes.push(n as Text);
  if (nodes.length !== segs.length) return null;

  const first = nodes.findIndex((n) => working.comparePoint(n, n.length) >= 0);
  let last = -1;
  nodes.forEach((n, i) => {
    if (working.comparePoint(n, 0) <= 0) last = i;
  });
  if (first < 0 || last < first) return null;
  const startAt = nodes[first] === working.startContainer ? working.startOffset : 0;
  const endAt = nodes[last] === working.endContainer ? working.endOffset : nodes[last].length;

  const from = offsetIn(segs[first], startAt, nodes[first].length, 'start');
  const to = offsetIn(segs[last], endAt, nodes[last].length, 'end');
  if (to <= from) return null;
  const slice = text.slice(from, to);
  if (slice.trim() === '' || parseCommentMarkers(slice).size > 0) return null;
  return { from, to };
}
