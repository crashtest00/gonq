import { parseCommentMarkers } from '../comment-threads';

/** Markdown edits for the formatting toolbar: pure functions from a field's text and selection to its new text and selection. */
export interface Edit {
  value: string;
  start: number;
  end: number;
}

export type Format = 'bold' | 'italic' | 'underline' | 'strike' | 'link' | 'bullet' | 'numbered' | 'task' | 'table';

const INLINE = ['bold', 'italic', 'underline', 'strike', 'link'];

/** Opening and closing text of each wrapping format; underline is written as `<ins>`. */
const WRAPS: Record<'bold' | 'italic' | 'underline' | 'strike', [string, string]> = {
  bold: ['**', '**'],
  italic: ['*', '*'],
  underline: ['<ins>', '</ins>'],
  strike: ['~~', '~~'],
};

/** Source ranges of fenced code blocks (whole lines, fences included) and inline code spans. */
function codeRanges(value: string): { from: number; to: number; fenced: boolean }[] {
  const out: { from: number; to: number; fenced: boolean }[] = [];
  const prose: [number, number][] = [];
  let open: { from: number; ch: string; len: number } | null = null;
  let proseFrom = 0;
  let at = 0;
  for (const line of value.split('\n')) {
    const lineEnd = at + line.length;
    const fence = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (open === null) {
      if (fence) {
        open = { from: at, ch: fence[1][0], len: fence[1].length };
        prose.push([proseFrom, at]);
      }
    } else if (fence && fence[1][0] === open.ch && fence[1].length >= open.len && line.trim() === fence[1]) {
      out.push({ from: open.from, to: lineEnd, fenced: true });
      open = null;
      proseFrom = lineEnd;
    }
    at = lineEnd + 1;
  }
  if (open !== null) out.push({ from: open.from, to: value.length, fenced: true });
  else prose.push([proseFrom, value.length]);
  for (const [from, to] of prose) {
    const text = value.slice(from, to);
    for (const m of text.matchAll(/(?<!`)(`+)(?!`)([\s\S]*?[^`])\1(?!`)/g)) {
      out.push({ from: from + m.index!, to: from + m.index! + m[0].length, fenced: false });
    }
  }
  return out;
}

/** A selection touching code: inline marks written there would be literal text, not formatting. */
function inCode(value: string, start: number, end: number): boolean {
  return codeRanges(value).some((r) => {
    const inside = (p: number) => (r.fenced ? p >= r.from && p <= r.to : p > r.from && p < r.to);
    return inside(start) || inside(end);
  });
}

/** Moves a selection to the edges of any comment marker it cuts into, so a marker is never split. */
function clampToMarkers(value: string, start: number, end: number): [number, number] {
  for (const m of [...parseCommentMarkers(value).values()].flat()) {
    if (start === end) {
      if (start > m.from && start < m.to) start = end = m.to;
      continue;
    }
    if (start > m.from && start < m.to) start = m.from;
    if (end > m.from && end < m.to) end = m.to;
  }
  return [start, end];
}

/** Leading indentation, quote, list, task or heading marks of a line: not part of its text. */
const BLOCK_PREFIX = /^(?:[ \t]*(?:>[ \t]*)*(?:(?:[-*+]|\d+[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?|[ \t]*#{1,6}[ \t]+)/;

/** Whether `[start, end)` is already wrapped in the marks, outside it or included in it. */
function wrapped(value: string, start: number, end: number, [open, close]: [string, string]): boolean {
  const inner = value.slice(start, end);
  return (
    (start >= open.length && value.slice(start - open.length, start) === open && value.slice(end, end + close.length) === close) ||
    (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close))
  );
}

/** A selection over several lines is wrapped line by line: marks never span a line break, a blank line or a list/heading prefix. */
function wrapLines(value: string, start: number, end: number, marks: [string, string]): Edit {
  const segs: [number, number][] = [];
  let at = value.lastIndexOf('\n', start - 1) + 1;
  while (at <= end) {
    const nl = value.indexOf('\n', at);
    const lineEnd = nl < 0 ? value.length : nl;
    let from = Math.max(at, start);
    let to = Math.min(lineEnd, end);
    if (from <= at) from = at + BLOCK_PREFIX.exec(value.slice(at, lineEnd))![0].length;
    const text = value.slice(from, to);
    from += text.length - text.trimStart().length;
    to -= text.length - text.trimEnd().length;
    if (to > from) segs.push([from, to]);
    if (nl < 0) break;
    at = nl + 1;
  }
  if (segs.length === 0) return { value, start, end };
  const off = segs.every(([f, t]) => wrapped(value, f, t, marks));
  // Forward pass with a running shift; the selection ends up covering the text of the first to the last line.
  let out = value;
  let shift = 0;
  let newStart = -1;
  let newEnd = end;
  for (const [f, t] of segs) {
    if (off || !wrapped(value, f, t, marks)) {
      const r = wrap(out, f + shift, t + shift, marks, true);
      shift += r.value.length - out.length;
      out = r.value;
      if (newStart < 0) newStart = r.start;
      newEnd = r.end;
    } else {
      if (newStart < 0) newStart = f + shift;
      newEnd = t + shift;
    }
  }
  return { value: out, start: newStart, end: newEnd };
}

function wrap(value: string, start: number, end: number, marks: [string, string], single = false): Edit {
  const [open, close] = marks;
  if (!single && value.slice(start, end).includes('\n')) return wrapLines(value, start, end, marks);
  // Selection already wrapped (marks just outside it, or included in it): unwrap.
  if (start >= open.length && value.slice(start - open.length, start) === open && value.slice(end, end + close.length) === close) {
    return {
      value: value.slice(0, start - open.length) + value.slice(start, end) + value.slice(end + close.length),
      start: start - open.length,
      end: end - open.length,
    };
  }
  const inner = value.slice(start, end);
  if (inner.length >= open.length + close.length && inner.startsWith(open) && inner.endsWith(close)) {
    const bare = inner.slice(open.length, inner.length - close.length);
    return { value: value.slice(0, start) + bare + value.slice(end), start, end: start + bare.length };
  }
  // Nothing selected leaves the caret between the marks.
  return { value: value.slice(0, start) + open + inner + close + value.slice(end), start: start + open.length, end: end + open.length };
}

const PREFIX = { bullet: /^([-*+]) /, numbered: /^\d+[.)] /, task: /^[-*+] \[[ xX]\] / } as const;
const INDENT = /^[ \t]*/;

function lines(value: string, start: number, end: number, kind: 'bullet' | 'numbered' | 'task'): Edit {
  const from = value.lastIndexOf('\n', start - 1) + 1;
  const nl = value.indexOf('\n', end > start && value[end - 1] === '\n' ? end - 1 : end);
  const to = nl < 0 ? value.length : nl;
  const rows = value.slice(from, to).split('\n');
  // A task line is also a bullet line, so check the more specific pattern first.
  const unindented = (r: string) => r.replace(INDENT, '');
  const has = (r: string) => (kind === 'bullet' ? PREFIX.bullet.test(unindented(r)) && !PREFIX.task.test(unindented(r)) : PREFIX[kind].test(unindented(r)));
  const content = rows.filter((r) => r.trim() !== '');
  const off = content.length > 0 && content.every(has);
  // Blank lines are skipped within a multi-line selection, but a selection of only blank lines (e.g. the caret on an empty line) is prefixed.
  const onlyBlank = content.length === 0;
  let n = 0;
  const out = rows.map((r) => {
    if (r.trim() === '' && !onlyBlank) return r;
    const indent = r.match(INDENT)![0];
    const bare = unindented(r).replace(PREFIX.task, '').replace(PREFIX.bullet, '').replace(PREFIX.numbered, '');
    if (off) return indent + bare;
    n++;
    return indent + (kind === 'bullet' ? '- ' : kind === 'task' ? '- [ ] ' : `${n}. `) + bare;
  });
  const text = out.join('\n');
  // A caret on a blank line lands after the new marker, ready to type.
  const caret = onlyBlank && start === end ? from + text.length : null;
  return { value: value.slice(0, from) + text + value.slice(to), start: caret ?? from, end: caret ?? from + text.length };
}

const TABLE = '| Column 1 | Column 2 |\n| --- | --- |\n| Cell | Cell |';

/** `url` is what the user entered for a link; it is ignored by every other format. */
export function applyFormat(format: Format, value: string, start: number, end: number, url = ''): Edit {
  if (INLINE.includes(format)) {
    [start, end] = clampToMarkers(value, start, end);
    if (inCode(value, start, end)) return { value, start, end };
  }
  switch (format) {
    case 'bold':
    case 'italic':
    case 'underline':
    case 'strike':
      return wrap(value, start, end, WRAPS[format]);
    case 'link': {
      const label = value.slice(start, end) || 'text';
      const link = `[${label}](${url})`;
      const at = start + link.length;
      return { value: value.slice(0, start) + link + value.slice(end), start: at, end: at };
    }
    case 'table': {
      // A table is its own block: separate it from text on the same line, and leave a blank line after it
      // with the caret there, so typing continues below the table.
      const before = value.slice(0, end);
      const lead = before === '' || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
      const rest = value.slice(end);
      // Whatever already follows (text, or another table) stays a separate block from the caret's line.
      const tail = rest.startsWith('\n') && !rest.startsWith('\n\n') ? '\n' : '';
      const at = before.length + lead.length + TABLE.length + 2;
      return { value: before + lead + TABLE + '\n\n' + tail + rest, start: at, end: at };
    }
    default:
      return lines(value, start, end, format);
  }
}
