import type { EditorView } from '@codemirror/view';
import { focusCaretCell } from './tables';

/** Where the caret sits, in px below the top of the editor's visible area (null when not drawn). */
export function caretOffset(view: EditorView): number | null {
  const cell = document.activeElement instanceof HTMLElement && view.contentDOM.contains(document.activeElement) ? document.activeElement.closest('td,th') : null;
  const top = cell ? cell.getBoundingClientRect().top : view.coordsAtPos(view.state.selection.main.head)?.top;
  return top === undefined ? null : top - view.scrollDOM.getBoundingClientRect().top;
}

/** Scroll so the caret is `offset` px below the top of the visible area again; returns whether it moved. */
export function restoreCaretOffset(view: EditorView, offset: number): boolean {
  const now = caretOffset(view);
  if (now === null) return false;
  const delta = now - offset;
  if (Math.abs(delta) < 1) return false;
  view.scrollDOM.scrollTop += delta;
  return true;
}

/**
 * After Raw -> Formatted the lines change height, so the caret would drift (often off-screen).
 * Re-measure, focus the table cell the caret was in, and scroll so the caret keeps its offset.
 * A second pass follows because CodeMirror refines estimated heights once the lines are drawn.
 */
export function keepCaretOffsetAfterSwitch(view: EditorView, before: number | null) {
  view.requestMeasure({
    read: () => null,
    write: () => {
      focusCaretCell(view);
      if (before === null) return;
      restoreCaretOffset(view, before);
      view.requestMeasure({ read: () => null, write: () => void restoreCaretOffset(view, before) });
    },
  });
}
