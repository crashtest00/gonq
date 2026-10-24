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

/** Room kept below the cell: the table toolbar appears once a cell has focus and takes height from the editor. */
const CELL_MARGIN = 48;

/** Scrolls `cell` into the editor's visible area, with room below for the table toolbar. */
function showCell(view: EditorView, cell: HTMLElement) {
  const sc = view.scrollDOM;
  const box = cell.getBoundingClientRect();
  const top = sc.getBoundingClientRect().top;
  if (box.bottom + CELL_MARGIN > top + sc.clientHeight) sc.scrollTop += box.bottom + CELL_MARGIN - (top + sc.clientHeight);
  else if (box.top < top) sc.scrollTop -= top - box.top;
}

/**
 * After Raw -> Formatted, enter the table cell the caret was in (Formatted only) and scroll it into view: the
 * table widget draws the cell lower than the caret position the scroll effect aimed at, and that effect and
 * the table toolbar (shown a frame after the focus) both move the cell again, so it is shown again after them.
 */
export function focusCaretCellAfterSwitch(view: EditorView) {
  view.requestMeasure({
    read: () => null,
    write: () => {
      if (!focusCaretCell(view)) return;
      const cell = view.contentDOM.ownerDocument.activeElement;
      if (!(cell instanceof HTMLElement) || !view.contentDOM.contains(cell)) return;
      showCell(view, cell);
      const again = () => cell.isConnected && showCell(view, cell);
      requestAnimationFrame(() => requestAnimationFrame(again));
      setTimeout(again, 150);
    },
  });
}
