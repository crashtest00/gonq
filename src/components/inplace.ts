/**
 * Editing a block where it is rendered. The block being edited ("active") is
 * rendered with every character of its source in a span that says where in the
 * file it comes from, so a caret in the rendered text is an exact offset in the
 * file, and back. Three kinds of span:
 * - `gonq-tx`: text shown as it is written in the source
 * - `gonq-mk`: Markdown syntax (`**`, `# `, `> `, fences...), hidden unless markers are shown
 * - `gonq-at`: text shown differently from how it is written (a thread marker glyph,
 *   an entity); the caret can sit before or after it, never inside it
 * Nothing here changes the document text; the spans only exist in the rendered tree.
 */

type HNode = {
  type: string;
  value?: string;
  tagName?: string;
  properties?: Record<string, unknown>;
  children?: HNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
};

export interface Range1 {
  from: number;
  to: number;
}

const BLOCK_TAGS = new Set(['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'pre', 'blockquote', 'table', 'hr', 'div']);
const CONTAINER_TAGS = new Set(['ul', 'ol', 'blockquote']);
const VOID_TAGS = new Set(['img', 'br', 'input', 'hr']);

/** Top-level blocks that are edited in place; a rule is not text to type into and keeps the Markdown field. */
export const IN_PLACE_TAGS = ['p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'pre', 'blockquote', 'table'] as const;

const span = (cls: string, s: number, text: string, extra: Record<string, unknown> = {}): HNode => ({
  type: 'element',
  tagName: 'span',
  properties: { className: [cls], dataS: s, ...extra },
  children: [{ type: 'text', value: text }],
});

const start = (n: HNode) => n.position?.start.offset;
const end = (n: HNode) => n.position?.end.offset;

/**
 * Splits the source `slice` of a node into the characters that are `value` (what
 * is rendered) and the characters that are syntax. Null when `value` is not a
 * subsequence of the slice (an entity, say): the caller then keeps it whole.
 */
export interface AlignedPart {
  kind: 'tx' | 'mk' | 'at';
  from: number;
  to: number;
  /** For `at`: the text it is shown as. */
  text?: string;
}

const ENTITY = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|[A-Za-z][A-Za-z0-9]{0,31});/y;
const ESCAPE = /\\[!-/:-@[-`{-~]/y;

let decoder: HTMLTextAreaElement | null = null;
/** What a character reference stands for, or null when it is not one. */
function decodeEntity(ref: string): string | null {
  if (typeof document === 'undefined') return null;
  decoder ??= document.createElement('textarea');
  decoder.innerHTML = ref;
  const out = decoder.value;
  return out === ref ? null : out;
}

/**
 * With `atomic`, entities (`&amp;`) and backslash escapes (`\*`) are single `at`
 * units: the whole of the source is the text for the character(s) they render.
 */
export function alignText(value: string, slice: string, atomic = false): AlignedPart[] | null {
  const out: AlignedPart[] = [];
  const push = (kind: 'tx' | 'mk', i: number) => {
    const last = out[out.length - 1];
    if (last && last.kind === kind && last.to === i) last.to = i + 1;
    else out.push({ kind, from: i, to: i + 1 });
  };
  let j = 0;
  for (let i = 0; i < slice.length; i++) {
    if (atomic && j < value.length && (slice[i] === '&' || slice[i] === '\\')) {
      const re = slice[i] === '&' ? ENTITY : ESCAPE;
      re.lastIndex = i;
      const m = re.exec(slice);
      const shown = m ? (slice[i] === '&' ? decodeEntity(m[0]) : m[0][1]) : null;
      if (m && shown && value.startsWith(shown, j)) {
        out.push({ kind: 'at', from: i, to: i + m[0].length, text: shown });
        i += m[0].length - 1;
        j += shown.length;
        continue;
      }
    }
    if (j < value.length && slice[i] === value[j]) {
      push('tx', i);
      j++;
    } else push('mk', i);
  }
  return j === value.length ? out : null;
}

const partSpan = (p: AlignedPart, s: number, slice: string): HNode =>
  p.kind === 'at'
    ? span('gonq-at', s + p.from, p.text ?? '', { dataLen: p.to - p.from })
    : span(p.kind === 'tx' ? 'gonq-tx' : 'gonq-mk', s + p.from, slice.slice(p.from, p.to));

/** Spans for a text-bearing node whose source is source[s, e) and whose rendered text is `value`. */
function textPieces(value: string, s: number, e: number, source: string, atomic = true): HNode[] {
  const slice = source.slice(s, e);
  const parts = alignText(value, slice, atomic);
  if (parts === null) return [span('gonq-at', s, value, { dataLen: e - s })];
  return parts.map((p) => partSpan(p, s, slice));
}

/** An inline code span: the backtick runs are syntax, and so is the space padding that is not shown. */
function codeSpanPieces(value: string, s: number, e: number, source: string): HNode[] {
  const slice = source.slice(s, e);
  const m = /^(`+)([\s\S]*?)(`+)$/.exec(slice);
  if (!m || m[1].length !== m[3].length) return textPieces(value, s, e, source, false);
  const open = m[1].length;
  const inner = m[2];
  const lead = inner.length > value.length && /^\s/.test(inner) ? 1 : 0;
  if (inner.slice(lead, inner.length - lead) !== value && inner.replace(/\r?\n/g, ' ').slice(lead, inner.length - lead) !== value) {
    return textPieces(value, s, e, source, false);
  }
  const parts: AlignedPart[] = [
    { kind: 'mk', from: 0, to: open + lead },
    { kind: 'tx', from: open + lead, to: slice.length - open - lead },
    { kind: 'mk', from: slice.length - open - lead, to: slice.length },
  ];
  return parts.filter((p) => p.to > p.from).map((p) => partSpan(p, s, slice));
}

const textOf = (n: HNode): string => (n.type === 'text' ? (n.value ?? '') : (n.children ?? []).map(textOf).join(''));

/** Where a fenced code block's opening fence line ends and its closing fence line starts, if it has them. */
function fenceParts(slice: string): { open: number; close: number } | null {
  const open = /^ {0,3}(`{3,}|~{3,})[^\n]*(?:\n|$)/.exec(slice);
  if (!open) return null;
  const fence = /(`{3,}|~{3,})/.exec(open[0])![1];
  let close = slice.length;
  const m = /(^|\n) {0,3}(`{3,}|~{3,})[ \t]*\r?$/.exec(slice.slice(open[0].length));
  if (m && m[2][0] === fence[0] && m[2].length >= fence.length) close = open[0].length + m.index + m[1].length;
  return { open: open[0].length, close };
}

function codeBlockPieces(code: HNode, s: number, e: number, source: string): HNode[] {
  const value = textOf(code);
  const slice = source.slice(s, e);
  const fence = fenceParts(slice);
  const out: HNode[] = [];
  let bodyFrom = 0;
  let bodyTo = slice.length;
  if (fence) {
    out.push(span('gonq-mk', s, slice.slice(0, fence.open)));
    bodyFrom = fence.open;
    bodyTo = fence.close;
  }
  const body = slice.slice(bodyFrom, bodyTo);
  const parts = alignText(value.replace(/\n$/, ''), body);
  if (parts === null) out.push(span('gonq-at', s + bodyFrom, value, { dataLen: bodyTo - bodyFrom }));
  else {
    for (const p of parts) out.push(partSpan(p, s + bodyFrom, body));
  }
  if (fence && bodyTo < slice.length) out.push(span('gonq-mk', s + bodyTo, slice.slice(bodyTo)));
  return out;
}

const isThreadLink = (n: HNode) => n.tagName === 'a' && typeof n.properties?.href === 'string' && /^#md-thread-/.test(n.properties.href as string);

const positioned = (c: HNode) => start(c) !== undefined;

/** The innermost element at the start of `el` that can hold inline text (a list item's paragraph, say). */
function firstHost(el: HNode): HNode {
  // Nothing but rows sits directly in a table: what precedes it (a list item's indent) goes in its first cell.
  if (el.tagName === 'table') return cellsOf(el)[0] ?? el;
  const first = (el.children ?? []).find(positioned);
  if ((CONTAINER_TAGS.has(el.tagName ?? '') || el.tagName === 'li') && first?.tagName && BLOCK_TAGS.has(first.tagName)) return firstHost(first);
  return el;
}

/** The same at the end of `el`. */
function lastHost(el: HNode): HNode {
  if (el.tagName === 'table') return cellsOf(el).slice(-1)[0] ?? el;
  const last = [...(el.children ?? [])].reverse().find(positioned);
  if ((CONTAINER_TAGS.has(el.tagName ?? '') || el.tagName === 'li') && last?.tagName && BLOCK_TAGS.has(last.tagName)) return lastHost(last);
  return el;
}

const cellsOf = (n: HNode): HNode[] =>
  (n.children ?? []).flatMap((c) => (c.tagName === 'th' || c.tagName === 'td' ? [c] : c.type === 'element' ? cellsOf(c) : []));

/**
 * A table: its cells carry their text; every pipe, delimiter row and line break is syntax inside some cell
 * (spans cannot sit between rows), and is never shown, whatever the markers option says.
 */
function decorateTable(table: HNode, source: string): void {
  const s = start(table) ?? 0;
  const e = end(table) ?? s;
  const cells = cellsOf(table).filter((c) => start(c) !== undefined && end(c) !== undefined);
  if (cells.length === 0) return;
  const gap = (from: number, to: number): HNode[] => (to > from ? [span('gonq-mk', from, source.slice(from, to))] : []);
  cells.forEach((cell, i) => {
    const cs = start(cell)!;
    const ce = end(cell)!;
    const lead = i === 0 ? gap(s, cs) : [];
    // Up to where the next cell starts (the line break and delimiter row between rows).
    const reach = i + 1 < cells.length ? Math.max(start(cells[i + 1])!, ce) : Math.max(e, ce);
    const trail = gap(ce, reach);
    if ((cell.children ?? []).length === 0) {
      // An empty cell still holds a caret, after its pipe and padding.
      const at = cs + /^\|?[ \t]?/.exec(source.slice(cs, ce))![0].length;
      cell.children = [...gap(cs, at), span('gonq-at', at, '\u200b', { dataLen: 0 }), ...gap(at, ce)];
    } else decorate(cell, source);
    cell.children = [...lead, ...(cell.children ?? []), ...trail];
  });
}

/** Fills `el` so that every character of its source range is in some span. */
function decorate(el: HNode, source: string): void {
  const s = start(el);
  const e = end(el);
  if (s === undefined || e === undefined) return;
  if (el.tagName === 'table') return decorateTable(el, source);
  const kids = el.children ?? [];

  if (isThreadLink(el)) {
    el.children = [span('gonq-at', s, textOf(el), { dataLen: e - s })];
    return;
  }
  if (el.tagName === 'pre') {
    const code = kids.find((c) => c.tagName === 'code');
    if (code) code.children = codeBlockPieces(code, s, e, source);
    return;
  }
  // An inline code span is aligned as a whole, backtick runs and all.
  if (el.tagName === 'code' && kids.length > 0 && kids.every((c) => c.type === 'text')) {
    el.children = codeSpanPieces(textOf(el), s, e, source);
    return;
  }
  // So is any other leaf that only holds text.
  if (kids.length > 0 && kids.every((c) => c.type === 'text' && c.position === undefined)) {
    el.children = textPieces(textOf(el), s, e, source);
    return;
  }

  const out: HNode[] = [];
  let pos = s;
  const gap = (from: number, to: number): HNode[] => (to > from ? [span('gonq-mk', from, source.slice(from, to))] : []);
  for (const child of kids) {
    const cs = start(child);
    const ce = end(child);
    if (cs === undefined || ce === undefined || cs < pos) {
      out.push(child);
      continue;
    }
    const before = gap(pos, cs);
    // Syntax at the very start goes ahead of generated nodes such as a task checkbox.
    const block = child.type === 'element' && child.tagName !== undefined && BLOCK_TAGS.has(child.tagName);
    if (!block) {
      if (pos === s) out.unshift(...before);
      else out.push(...before);
    }
    if (child.type === 'text') {
      out.push(...textPieces(child.value ?? '', cs, ce, source));
    } else if (child.type === 'element' && child.tagName && VOID_TAGS.has(child.tagName) && !BLOCK_TAGS.has(child.tagName)) {
      out.push(span('gonq-mk', cs, source.slice(cs, ce)), child);
    } else if (child.type === 'element') {
      decorate(child, source);
      if (child.tagName && BLOCK_TAGS.has(child.tagName)) {
        // Syntax cannot sit between blocks: what precedes a block goes inside it, at its start.
        if (before.length > 0) {
          const host = firstHost(child);
          host.children = [...before, ...(host.children ?? [])];
        }
        out.push(child);
      } else out.push(child);
    } else {
      out.push(child);
      continue;
    }
    pos = ce;
  }
  el.children = out;
  const tail = gap(pos, e);
  if (tail.length > 0) {
    const host = lastHost(el);
    if (host !== el) host.children = [...(host.children ?? []), ...tail];
    else out.push(...tail);
  }
}

/**
 * Rehype plugin: gives the blocks in `ranges` (source ranges, shifted by `base`
 * when only part of the document is rendered) their source-carrying spans.
 */
export function rehypeSourceSpans(options: { source: string; ranges: Range1[]; base?: number }) {
  const { source, ranges, base = 0 } = options;
  return (tree: HNode) => {
    if (ranges.length === 0) return;
    const blanks = ranges.filter((r) => r.from === r.to);
    for (const block of tree.children ?? []) {
      const s = start(block);
      const e = end(block);
      if (block.type !== 'element' || s === undefined || e === undefined) continue;
      if (!ranges.some((r) => r.from === base + s && r.to === base + e)) continue;
      // An edit can turn the block into one that is not edited in place (`****` is a rule); it is drawn plain.
      if (!(IN_PLACE_TAGS as readonly string[]).includes(block.tagName ?? '')) continue;
      // Positions are relative to the rendered piece; the slices come from the same piece.
      decorate(block, source);
    }
    // A caret on a line of its own between blocks (after Enter at the end of a paragraph) sits in an empty paragraph.
    const kids = tree.children ?? (tree.children = []);
    for (const { from } of blanks) {
      const at = from - base;
      const next = kids.findIndex((c) => c.type === 'element' && (start(c) ?? -1) > at);
      const empty: HNode = {
        type: 'element',
        tagName: 'p',
        properties: { dataFrom: from, dataTo: from, dataActive: '', dataVirtual: '' },
        children: [span('gonq-at', at + base, '\u200b', { dataLen: 0 })],
      };
      kids.splice(next < 0 ? kids.length : next, 0, empty);
    }
  };
}

// ---------------------------------------------------------------------------
// Rendered tree <-> file offsets

const PIECE = '[data-s]';

export interface Piece {
  el: HTMLElement;
  s: number;
  /** Characters of source it stands for. */
  len: number;
  kind: 'tx' | 'mk' | 'at';
}

function pieceOfEl(el: HTMLElement): Piece {
  const kind = el.classList.contains('gonq-mk') ? 'mk' : el.classList.contains('gonq-at') ? 'at' : 'tx';
  const len = kind === 'at' ? Number(el.dataset.len) : (el.textContent ?? '').length;
  return { el, s: Number(el.dataset.s), len, kind };
}

/** Every source-carrying span under `root`, in document order. */
export function piecesIn(root: Element): Piece[] {
  return Array.from(root.querySelectorAll<HTMLElement>(PIECE)).map(pieceOfEl);
}

const pieceAround = (node: Node): HTMLElement | null => {
  const el = node instanceof Element ? node : node.parentElement;
  return el?.closest<HTMLElement>(PIECE) ?? null;
};

/** Whether a piece is on screen: syntax pieces only when markers are shown. */
export const isVisible = (p: Piece, showMarkers: boolean) => p.kind !== 'mk' || (showMarkers && !p.el.closest('table'));

/**
 * The file offset of a point in the rendered tree, or null when it is not in a
 * block that carries source spans. A point inside a glyph that stands for more
 * source than it shows snaps to the nearer end.
 */
export function pointToOffset(root: Element, node: Node, offset: number): number | null {
  if (!root.contains(node)) return null;
  const holder = pieceAround(node);
  if (holder) {
    const p = pieceOfEl(holder);
    if (node.nodeType === Node.TEXT_NODE) {
      if (p.kind !== 'at') return p.s + Math.min(offset, p.len);
      return offset * 2 <= (node.textContent ?? '').length ? p.s : p.s + p.len;
    }
    return offset === 0 ? p.s : p.s + p.len;
  }
  // Between pieces: just after the last piece of the block that lies before the point.
  const block = (node instanceof Element ? node : node.parentElement)?.closest<HTMLElement>('[data-active]');
  if (!block) return null;
  const boundary = root.ownerDocument.createRange();
  try {
    boundary.setStart(node, offset);
  } catch {
    return null;
  }
  boundary.collapse(true);
  let at = Number(block.dataset.from);
  for (const p of piecesIn(block)) {
    if (boundary.comparePoint(p.el, p.el.childNodes.length) <= 0) at = p.s + p.len;
  }
  return at;
}

/** The point in the rendered tree for a file offset, preferring text that is on screen. */
export function offsetToPoint(root: Element, offset: number, showMarkers: boolean): [Node, number] | null {
  const pieces = piecesIn(root);
  const covering = pieces.filter((p) => p.s <= offset && offset <= p.s + p.len);
  const pick = covering.find((p) => isVisible(p, showMarkers) && p.len > 0) ?? covering[0];
  if (!pick) return null;
  const text = pick.el.firstChild;
  if (!text) return [pick.el, 0];
  if (pick.kind === 'at') return [text, offset <= pick.s ? 0 : (text.textContent ?? '').length];
  return [text, offset - pick.s];
}

/** How many characters of text on screen come before a point inside `block` (syntax pieces do not count). */
export function visibleIndex(block: Element, node: Node, offset: number): number {
  const range = block.ownerDocument.createRange();
  range.setStart(block, 0);
  try {
    range.setEnd(node, offset);
  } catch {
    return 0;
  }
  let n = 0;
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
    if (t.parentElement?.closest('.gonq-mk')) continue;
    if (range.comparePoint(t, 0) > 0) break;
    n += range.comparePoint(t, t.length) <= 0 ? t.length : offset;
  }
  return n;
}

/** Inverse of `visibleIndex`, in a block whose spans are in place; returns a file offset. */
export function visibleIndexToOffset(block: Element, index: number): number | null {
  const walker = block.ownerDocument.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  let left = index;
  let last: number | null = null;
  for (let t = walker.nextNode() as Text | null; t; t = walker.nextNode() as Text | null) {
    const holder = t.parentElement?.closest<HTMLElement>(PIECE);
    if (t.parentElement?.closest('.gonq-mk')) continue;
    if (!holder) {
      // Text the source has no characters for (the space after a checkbox).
      left -= Math.min(left, t.length);
      continue;
    }
    const p = pieceOfEl(holder);
    if (left <= t.length) return p.kind === 'at' ? (left * 2 <= t.length ? p.s : p.s + p.len) : p.s + left;
    left -= t.length;
    last = p.s + p.len;
  }
  return last ?? (block instanceof HTMLElement ? Number(block.dataset.from) : null);
}

/**
 * A line break written \r\n is one unit: an offset between the two moves out of it
 * (a caret goes after the break; the start of a range goes before it, the end after it).
 */
export function snapCrlf(text: string, lo: number, hi: number): [number, number] {
  const inside = (n: number) => text[n - 1] === '\r' && text[n] === '\n';
  if (lo === hi) return inside(lo) ? [lo + 1, lo + 1] : [lo, hi];
  return [inside(lo) ? lo - 1 : lo, inside(hi) ? hi + 1 : hi];
}
