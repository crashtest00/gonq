import { EditorView } from '@codemirror/view';
import { focusCaretCell } from './tables';

/** Where the caret sits, in px below the top of the editor's visible area (null when not drawn or outside the visible area). */
export function caretOffset(view: EditorView): number | null {
  const top = view.coordsAtPos(view.state.selection.main.head)?.top;
  if (top === undefined) return null;
  const offset = top - view.scrollDOM.getBoundingClientRect().top;
  return offset >= 0 && offset < view.scrollDOM.clientHeight ? offset : null;
}

/**
 * The effect that follows the caret after Raw <-> Formatted changes the line heights: keep it `offset` px
 * below the top of the visible area, or centre it when it was off-screen (`offset` null).
 * CodeMirror re-applies it while the estimated line heights settle.
 */
export function keepCaretVisible(view: EditorView, offset: number | null) {
  const head = view.state.selection.main.head;
  return offset === null ? EditorView.scrollIntoView(head, { y: 'center' }) : EditorView.scrollIntoView(head, { y: 'start', yMargin: offset });
}

/** After Raw -> Formatted, enter the table cell the caret was in (Formatted only). */
export function focusCaretCellAfterSwitch(view: EditorView) {
  view.requestMeasure({ read: () => null, write: () => void focusCaretCell(view) });
}
