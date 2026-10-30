/** Toolbar formats applied to an EditorView (formatView, diff) and the formatting keymap (Ctrl+B/I/U/K/Shift+X). */
import { keymap, type Command, type EditorView } from '@codemirror/view';
import { applyFormat, type Format } from '../model/formatting';

/** The smallest single change turning `a` into `b`; only the differing middle is touched. */
export function diff(a: string, b: string): { from: number; to: number; insert: string } {
  let start = 0;
  const max = Math.min(a.length, b.length);
  while (start < max && a[start] === b[start]) start++;
  let end = 0;
  while (end < max - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++;
  return { from: start, to: a.length - end, insert: b.slice(start, b.length - end) };
}

/** Applies a toolbar format to the main selection as ordinary editor changes. */
export function formatView(v: EditorView, format: Format, url = ''): void {
  const value = v.state.doc.toString();
  const sel = v.state.selection.main;
  const next = applyFormat(format, value, sel.from, sel.to, url);
  v.dispatch({
    ...(next.value === value ? {} : { changes: diff(value, next.value) }),
    selection: { anchor: next.start, head: next.end },
    userEvent: 'input.format',
    scrollIntoView: true,
  });
}

const formatCommand = (format: Format): Command => (view) => (formatView(view, format), true);

/** The link address to write; cancelling (or an empty answer) changes nothing. */
export function askUrl(): string | null {
  return window.prompt('Link URL', 'https://')?.trim() || null;
}

/** Keyboard shortcuts for the formatting toolbar's inline formats. */
export const formatKeymap = keymap.of([
  { key: 'Mod-b', run: formatCommand('bold'), preventDefault: true },
  { key: 'Mod-i', run: formatCommand('italic'), preventDefault: true },
  { key: 'Mod-u', run: formatCommand('underline'), preventDefault: true },
  { key: 'Mod-Shift-x', run: formatCommand('strike'), preventDefault: true },
  {
    key: 'Mod-k',
    preventDefault: true,
    run: (view) => {
      const url = askUrl();
      if (url !== null) formatView(view, 'link', url);
      return true;
    },
  },
]);
