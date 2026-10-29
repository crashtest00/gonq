/** Typing on the line under a table keeps the text out of the table. */
import { EditorView } from '@codemirror/view';
import { settleView } from '../testing/editor';
import { createEditorState } from './extensions';

test('typing char by char on the line under a table keeps every character', () => {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ state: createEditorState('| h | i |\n| - | - |\n| a | b |\n', false), parent });
  try {
    settleView(view);
    view.focus();
    let pos = view.state.doc.length;
    for (const ch of 'hello world') {
      view.dispatch({ changes: { from: pos, insert: ch }, selection: { anchor: pos + 1 }, userEvent: 'input.type' });
      settleView(view);
      pos++;
    }
    expect(view.state.doc.toString()).toBe('| h | i |\n| - | - |\n| a | b |\nhello world');
    expect(view.state.selection.main.head).toBe(view.state.doc.length);
  } finally {
    view.destroy();
    parent.remove();
  }
});

test('a line without a pipe under a table is not a table row', () => {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ state: createEditorState('| h | i |\n| - | - |\n| a | b |\nh', false), parent });
  try {
    settleView(view);
    expect(view.contentDOM.querySelectorAll('tr')).toHaveLength(2);
    expect(view.contentDOM.textContent).toContain('h');
  } finally {
    view.destroy();
    parent.remove();
  }
});
