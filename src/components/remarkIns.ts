/**
 * Renders `<ins>…</ins>` as an underline while raw HTML stays skipped: an inline
 * `<ins>` / `</ins>` pair of html nodes becomes one node that turns into an `ins`
 * element. Any other HTML is left for `skipHtml` to drop.
 */
type Point = { line: number; column: number; offset?: number };
type Node = { type: string; value?: string; children?: Node[]; data?: { hName: string }; position?: { start: Point; end: Point } };

function wrapPairs(parent: Node) {
  const kids = parent.children;
  if (!kids) return;
  for (let i = 0; i < kids.length; i++) {
    const open = kids[i];
    if (open.type === 'html' && open.value === '<ins>') {
      const close = kids.findIndex((k, j) => j > i && k.type === 'html' && k.value === '</ins>');
      if (close > i) {
        // The pair's own range, so the tags count as source of the element they make.
        const closing = kids[close].position;
        const inner = kids.splice(i + 1, close - i - 1);
        const position = open.position && closing ? { start: open.position.start, end: closing.end } : undefined;
        kids.splice(i, 2, { type: 'ins', data: { hName: 'ins' }, children: inner, ...(position ? { position } : {}) });
      }
    }
    wrapPairs(kids[i]);
  }
}

export function remarkIns() {
  return (tree: Node) => wrapPairs(tree);
}
