import { EditorState } from '@codemirror/state';
import { EditorView, runScopeHandlers } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { settleView } from '../testing/editor';
import { createEditorState } from './extensions';

function press(doc: string, init: { key: string; ctrlKey?: boolean; shiftKey?: boolean }, from: number, to: number) {
  const view = new EditorView({ state: EditorState.create({ doc }) });
  view.setState(createEditorState(doc, false));
  settleView(view);
  view.dispatch({ selection: { anchor: from, head: to } });
  runScopeHandlers(view, new KeyboardEvent('keydown', init), 'editor');
  return view.state.doc.toString();
}

describe('formatting shortcuts', () => {
  it('Ctrl+B bolds, Ctrl+I italicises, Ctrl+U underlines, Ctrl+Shift+X strikes', () => {
    expect(press('word', { key: 'b', ctrlKey: true }, 0, 4)).toBe('**word**');
    expect(press('word', { key: 'i', ctrlKey: true }, 0, 4)).toBe('*word*');
    expect(press('word', { key: 'u', ctrlKey: true }, 0, 4)).toBe('<ins>word</ins>');
    expect(press('word', { key: 'x', ctrlKey: true, shiftKey: true }, 0, 4)).toBe('~~word~~');
  });
});
