import { outlineOf } from './outline';

/** The markers that make an inserted table of contents findable again. The list between them is plain Markdown. */
export const TOC_START = '<!-- toc -->';
export const TOC_END = '<!-- /toc -->';
export const TOC_EMPTY = '_No headings yet._';

export interface TocRange {
  from: number;
  to: number;
}

/** The first table of contents in the text, from its start marker to the end of its end marker (null when there is none). */
export function findToc(text: string): TocRange | null {
  const m = /^[ \t]*<!-- toc -->[ \t]*$[\s\S]*?^[ \t]*<!-- \/toc -->[ \t]*$/m.exec(text);
  return m ? { from: m.index, to: m.index + m[0].length } : null;
}

/** GitHub-style anchor for a heading; `seen` numbers repeated headings (-1, -2). */
function slug(text: string, seen: Map<string, number>): string {
  const base = text.toLowerCase().replace(/[^\p{L}\p{N}\s_-]/gu, '').trim().replace(/\s+/g, '-');
  const n = seen.get(base) ?? 0;
  seen.set(base, n + 1);
  return n === 0 ? base : `${base}-${n}`;
}

/** The marked block for the headings of `text`: a nested list, one level of nesting per heading level. The block never lists itself. */
export function buildToc(text: string): string {
  const own = findToc(text);
  const rest = own ? text.slice(0, own.from) + text.slice(own.to) : text;
  const seen = new Map<string, number>();
  const stack: number[] = [];
  const lines = outlineOf(rest).map((h) => {
    while (stack.length > 0 && stack[stack.length - 1] >= h.level) stack.pop();
    stack.push(h.level);
    const label = h.text.replace(/[[\]]/g, '\\$&');
    return `${'  '.repeat(stack.length - 1)}- [${label}](#${slug(h.text, seen)})`;
  });
  return [TOC_START, ...(lines.length > 0 ? lines : [TOC_EMPTY]), TOC_END].join('\n');
}

/**
 * The change that inserts a table of contents at `caret`, or that refreshes the existing one in place
 * (a document holds one: inserting again rebuilds it rather than adding a second). Never runs on its own.
 */
export function tocChange(text: string, caret: number): { from: number; to: number; insert: string; refreshed: boolean } {
  const block = buildToc(text);
  const own = findToc(text);
  if (own) return { ...own, insert: block, refreshed: true };
  // The block sits on lines of its own, set off by a blank line from what is around it.
  const gap = (newlines: number) => '\n'.repeat(Math.max(0, 2 - newlines));
  const trailing = /\n*$/.exec(text.slice(0, caret))![0].length;
  const leading = /^\n*/.exec(text.slice(caret))![0].length;
  const before = caret > 0 ? gap(trailing) : '';
  const after = caret < text.length && leading < text.length - caret ? gap(leading) : '';
  return { from: caret, to: caret, insert: `${before}${block}${after}`, refreshed: false };
}
