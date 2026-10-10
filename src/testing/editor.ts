import { act, screen } from '@testing-library/react';
import { EditorView } from '@codemirror/view';

/** Helpers for tests of the CodeMirror editor: the view is driven with transactions, as keyboard and mouse input would. */

export function editorView(): EditorView {
  const dom = screen.getByTestId('editor').querySelector<HTMLElement>('.cm-editor');
  const view = dom && EditorView.findFromDOM(dom);
  if (!view) throw new Error('no editor is shown');
  return view;
}

export const queryEditor = () => screen.queryByTestId('editor');

/** The document text as the editor holds it. */
export const docText = () => editorView().state.doc.toString();

/** Types `text` at the caret, replacing the selection. */
export function type(text: string) {
  const view = editorView();
  act(() => view.dispatch(view.state.replaceSelection(text)));
}

export function select(anchor: number, head = anchor) {
  const view = editorView();
  act(() => view.dispatch({ selection: { anchor, head } }));
}

/** Offset of `needle` in the document (its start, or its end with `end`). */
export function at(needle: string, end = false): number {
  const i = docText().indexOf(needle);
  if (i < 0) throw new Error(`"${needle}" is not in the document`);
  return end ? i + needle.length : i;
}

/** Selects the first occurrence of `needle`. */
export function selectText(needle: string) {
  select(at(needle), at(needle, true));
}

/** Puts the caret in `needle`, `offset` characters in (default: its end). */
export function caretAt(needle: string, offset?: number) {
  select(at(needle) + (offset ?? needle.length));
}

/** The text on screen: the document with the syntax the live preview hides left out. */
export const shownText = () => screen.getByTestId('editor').querySelector('.cm-content')?.textContent ?? '';
