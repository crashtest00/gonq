import { unified } from 'unified';
import remarkParse from 'remark-parse';
import remarkGfm from 'remark-gfm';
import type { Heading, Nodes, Root } from 'mdast';
import { parseCommentMarkerFragment } from '../comment-threads';
import { maskThreadBlocks } from './MarkdownView';

export type OutlineItem = { level: 1 | 2; text: string; from: number };

const parser = unified().use(remarkParse).use(remarkGfm);

/** A heading's plain text; comment-thread markers are not part of it. */
function plain(node: Nodes): string {
  if (node.type === 'link' && parseCommentMarkerFragment(node.url) !== undefined) return '';
  if (node.type === 'text' || node.type === 'inlineCode') return node.value;
  if (node.type === 'image') return node.alt ?? '';
  return 'children' in node ? node.children.map(plain).join('') : '';
}

function collect(node: Nodes, out: OutlineItem[]) {
  if (node.type === 'heading') {
    const h: Heading = node;
    const text = plain(h).replace(/\s+/g, ' ').trim();
    const from = h.position?.start.offset;
    if (h.depth <= 2 && text !== '' && from !== undefined) out.push({ level: h.depth as 1 | 2, text, from });
    return;
  }
  if ('children' in node) for (const child of node.children) collect(child, out);
}

/**
 * The H1 and H2 headings (ATX and setext) of a document, in order, read from
 * the same Markdown parse the viewer renders. Comment thread blocks are masked
 * out first. `from` is the heading's offset in the file, which is also the
 * `data-from` of the rendered heading.
 */
export function outlineOf(text: string): OutlineItem[] {
  const items: OutlineItem[] = [];
  collect(parser.parse(maskThreadBlocks(text)) as Root, items);
  return items;
}
