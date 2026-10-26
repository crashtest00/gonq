import { EditorView, runScopeHandlers } from '@codemirror/view';
import { describe, expect, it } from 'vitest';
import { settleView } from '../testing/editor';
import { createEditorState } from './extensions';

type Key = { key: string; ctrlKey?: boolean; metaKey?: boolean; shiftKey?: boolean };

function setup(doc: string, raw: boolean, at: number, to = at) {
  const view = new EditorView({ state: createEditorState(doc, raw) });
  settleView(view);
  view.dispatch({ selection: { anchor: at, head: to } });
  return view;
}
const press = (view: EditorView, init: Key) =>
  runScopeHandlers(view, new KeyboardEvent('keydown', { cancelable: true, ...init }), 'editor');

describe.each([false, true])('editor shortcuts (raw: %s)', (raw) => {
  const DOC = 'first line\nsecond line here\nthird';
  it('Ctrl+B / Ctrl+I', () => {
    for (const [key, out] of [['b', '**word**'], ['i', '*word*']]) {
      const v = setup('word', raw, 0, 4);
      press(v, { key, ctrlKey: true });
      expect(v.state.doc.toString()).toBe(out);
    }
  });
  it('Ctrl+Z / Ctrl+Y / Ctrl+Shift+Z', () => {
    const v = setup('a', raw, 1);
    v.dispatch(v.state.replaceSelection('b'), { userEvent: 'input.type' });
    expect(v.state.doc.toString()).toBe('ab');
    expect(press(v, { key: 'z', ctrlKey: true })).toBe(true);
    expect(v.state.doc.toString()).toBe('a');
    expect(press(v, { key: 'y', ctrlKey: true })).toBe(true);
    expect(v.state.doc.toString()).toBe('ab');
    press(v, { key: 'z', ctrlKey: true });
    press(v, { key: 'z', ctrlKey: true, shiftKey: true });
    expect(v.state.doc.toString()).toBe('ab');
  });
  it('Ctrl+A selects everything', () => {
    const v = setup(DOC, raw, 3);
    press(v, { key: 'a', ctrlKey: true });
    expect(v.state.selection.main).toMatchObject({ from: 0, to: DOC.length });
  });
  it('Ctrl+Home / Ctrl+End', () => {
    const v = setup(DOC, raw, 15);
    press(v, { key: 'End', ctrlKey: true });
    expect(v.state.selection.main.head).toBe(DOC.length);
    press(v, { key: 'Home', ctrlKey: true });
    expect(v.state.selection.main.head).toBe(0);
  });
  it('Home / End', () => {
    const v = setup(DOC, raw, 15);
    expect(press(v, { key: 'Home' })).toBe(true);
    expect(v.state.selection.main.head).toBe(11);
    expect(press(v, { key: 'End' })).toBe(true);
    expect(v.state.selection.main.head).toBe(27);
  });
  it('Ctrl+Backspace deletes the previous word', () => {
    const v = setup('one two', raw, 7);
    press(v, { key: 'Backspace', ctrlKey: true });
    expect(v.state.doc.toString()).toBe('one ');
  });
  it('Ctrl+F opens a find panel', () => {
    const v = setup(DOC, raw, 0);
    expect(press(v, { key: 'f', ctrlKey: true })).toBe(true);
    expect(v.dom.querySelector('.cm-search')).not.toBeNull();
  });
});
