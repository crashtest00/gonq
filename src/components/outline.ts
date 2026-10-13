import { markdownLanguage } from '@codemirror/lang-markdown';
import { parseCommentMarkerFragment } from '../comment-threads';

export type OutlineItem = { level: 1 | 2; text: string; from: number };

/** A heading's text with its Markdown syntax and comment-thread markers taken out. */
function plain(src: string): string {
  return src
    .replace(/\[[^\]]*\]\(([^)]*)\)/g, (m) => {
      const url = /\(([^)]*)\)$/.exec(m)?.[1] ?? '';
      return parseCommentMarkerFragment(url) !== undefined ? '' : m.replace(/^\[|\]\([^)]*\)$/g, '');
    })
    .replace(/<\/?ins>/gi, '')
    .replace(/(\*\*|__|~~|[*`])/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * The H1 and H2 headings (ATX and setext) of a document, in order, read from the same Markdown
 * parse the editor styles. Thread blocks are HTML comments, so they hold no headings. `from` is the
 * heading's offset in the text.
 */
export function outlineOf(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  markdownLanguage.parser.parse(text).iterate({
    enter(n) {
      const m = /^(?:ATX|Setext)Heading([12])$/.exec(n.name);
      if (!m) return;
      let src = text.slice(n.from, n.to);
      if (n.name.startsWith('Setext')) src = src.slice(0, src.indexOf('\n'));
      else src = src.replace(/^#+[ \t]*/, '').replace(/[ \t]+#+[ \t]*$/, '');
      const label = plain(src);
      if (label !== '') items.push({ level: Number(m[1]) as 1 | 2, text: label, from: n.from });
      return false;
    },
  });
  return items;
}
