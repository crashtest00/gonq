import type { EditorView } from '@codemirror/view';
import { focusCaretCell } from './tables';

/** Where the caret sits, in px below the top of the editor's visible area (null when not drawn). */
export function caretOffset(view: EditorView): number | null {
  const cell = document.activeElement instanceof HTMLElement && view.contentDOM.contains(document.activeElement) ? document.activeElement.closest('td,th') : null;
  const top = cell ? cell.getBoundingClientRect().top : view.coordsAtPos(view.state.selection.main.head)?.top;
  return top === undefined ? null : top - view.scrollDOM.getBoundingClientRect().top;
}

/** How far the caret has drifted from `offset` px below the top of the visible area (0 when not drawn). Layout read: only call it outside a write phase. */
export function caretDrift(view: EditorView, offset: number): number {
  const now = caretOffset(view);
  return now === null ? 0 : now - offset;
}

/** Scroll so the caret is `offset` px below the top of the visible area again; returns whether it moved. */
export function restoreCaretOffset(view: EditorView, offset: number): boolean {
  const delta = caretDrift(view, offset);
  if (Math.abs(delta) < 1) return false;
  view.scrollDOM.scrollTop += delta;
  return true;
}

/** Estimated line heights take several measure cycles to converge on long documents. */
const SETTLE_PASSES = 8;

/** One CodeMirror measure cycle: the layout is read in `read`, only scrollTop is set in `write`. */
function settle(view: EditorView, before: number, passes: number) {
  view.requestMeasure({
    read: () => caretDrift(view, before),
    write: (delta) => {
      if (Math.abs(delta) >= 1) view.scrollDOM.scrollTop += delta;
      // CodeMirror refines estimated line heights once the lines are drawn: look again.
      if (passes > 1) settle(view, before, passes - 1);
    },
  });
}

/**
 * After Raw -> Formatted the lines change height, so the caret would drift (often off-screen).
 * Focus the table cell the caret was in, then scroll so the caret keeps its offset.
 * Layout is only read in measure `read` phases (CodeMirror forbids it in `write`).
 */
export function keepCaretOffsetAfterSwitch(view: EditorView, before: number | null) {
  view.requestMeasure({
    read: () => null,
    write: () => {
      focusCaretCell(view);
      if (before !== null) settle(view, before, SETTLE_PASSES);
    },
  });
}
