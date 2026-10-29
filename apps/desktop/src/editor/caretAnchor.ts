/** Keeps the caret in place on screen when Raw <-> Formatted changes line heights (caretOffset, keepCaretVisible). */
import { EditorSelection } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { tableAt } from './tables';

/** Where the caret sits, in px below the top of the editor's visible area (null when not drawn or outside the visible area). */
export function caretOffset(view: EditorView): number | null {
  const top = view.coordsAtPos(view.state.selection.main.head)?.top;
  if (top === undefined) return null;
  const offset = top - view.scrollDOM.getBoundingClientRect().top;
  return offset >= 0 && offset < view.scrollDOM.clientHeight ? offset : null;
}

/** Room kept below a table: the table toolbar appears once a cell has focus and takes this much height from the editor. */
const TABLE_TOOLBAR = 40;

/**
 * The effect that follows the caret after Raw <-> Formatted changes the line heights: keep it `offset` px
 * below the top of the visible area, or centre it when it was off-screen (`offset` null).
 * With `toFormatted` and the caret in a table, show the whole table instead (the caret's cell is drawn lower
 * than its source position and is focused afterwards), with room for the table toolbar.
 * CodeMirror re-applies it while the estimated line heights settle.
 */
export function keepCaretVisible(view: EditorView, offset: number | null, toFormatted: boolean) {
  const head = view.state.selection.main.head;
  const table = toFormatted ? tableAt(view, head) : undefined;
  if (table) return EditorView.scrollIntoView(EditorSelection.range(table.from, table.to), { y: 'nearest', yMargin: TABLE_TOOLBAR });
  return offset === null ? EditorView.scrollIntoView(head, { y: 'center' }) : EditorView.scrollIntoView(head, { y: 'start', yMargin: offset });
}
