import { maskThreadBlocks } from './MarkdownView';

export type OutlineItem = { level: number; text: string; from: number };

/** Strips the inline markup a heading shows as plain text in the outline. */
function plain(s: string): string {
  return s
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_~]/g, '')
    .trim();
}

/**
 * The ATX headings of a document, in order, outside fenced code and comment
 * thread blocks. `from` is the heading's offset in the file, which is also the
 * `data-from` of the rendered heading.
 */
export function outlineOf(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const line of maskThreadBlocks(text).split('\n')) {
    const start = offset;
    offset += line.length + 1;
    const bare = line.replace(/\r$/, '');
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(bare);
    if (fence !== null) {
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && bare.trim() === f[1]) fence = null;
      continue;
    }
    if (f) {
      fence = f[1];
      continue;
    }
    const h = /^( {0,3})(#{1,6})(?:[ \t]+(.*?))?[ \t]*$/.exec(bare);
    if (!h) continue;
    const label = plain((h[3] ?? '').replace(/[ \t]+#+$/, '').replace(/^#+$/, ''));
    if (label !== '') items.push({ level: h[2].length, text: label, from: start + h[1].length });
  }
  return items;
}
