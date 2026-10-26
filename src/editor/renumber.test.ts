/** renumberAfter on a state whose syntax tree has not yet been parsed up to the list it renumbers. */
import { syntaxTreeAvailable } from '@codemirror/language';
import { indentMore } from '@codemirror/commands';
import type { EditorView } from '@codemirror/view';
import { createEditorState } from './extensions';
import { renumberAfter } from './renumber';

test('Tab renumbers a list that lies beyond the part of the document parsed so far', () => {
  const list = '1. a\n2. b\n3. c';
  const text = 'para\n\n'.repeat(100000) + list;
  let state = createEditorState(text, false);
  const caret = text.length - 5; // on item "b"
  state = state.update({ selection: { anchor: caret } }).state;
  expect(syntaxTreeAvailable(state, state.doc.length)).toBe(false); // the premise: the tree stops short of the list
  let doc = '';
  const view = { state, dispatch: (spec: object) => void (doc = state.update(spec).state.doc.toString()) } as unknown as EditorView;
  expect(renumberAfter(indentMore)(view)).toBe(true);
  expect(doc.endsWith('1. a\n    1. b\n2. c')).toBe(true);
});
