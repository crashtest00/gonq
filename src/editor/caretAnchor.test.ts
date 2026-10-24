import { afterEach, describe, expect, test } from 'vitest';
import { EditorView } from '@codemirror/view';
import { createEditorState } from './extensions';
import { caretOffset, restoreCaretOffset } from './caretAnchor';

const views: EditorView[] = [];
afterEach(() => views.splice(0).forEach((v) => v.destroy()));

/** A view whose caret is drawn at `top` px (jsdom has no layout, so the geometry is faked). */
function fake(text: string, caret: number, top: () => number) {
  const view = new EditorView({ state: createEditorState(text, false), parent: document.body.appendChild(document.createElement('div')) });
  views.push(view);
  view.dispatch({ selection: { anchor: caret } });
  view.coordsAtPos = () => ({ top: top(), bottom: top() + 20, left: 0, right: 0 });
  view.scrollDOM.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  return view;
}

describe('caret offset across Raw -> Formatted', () => {
  test('offset is measured from the top of the visible area', () => {
    expect(caretOffset(fake('a\nb', 2, () => 130))).toBe(30);
  });
  test('scrolls by the drift so the caret keeps its offset', () => {
    let top = 130;
    const v = fake('a\nb', 2, () => top);
    const before = caretOffset(v)!;
    top = 330; // formatted lines are taller: the caret moved down 200px
    v.scrollDOM.scrollTop = 50;
    expect(restoreCaretOffset(v, before)).toBe(true);
    expect(v.scrollDOM.scrollTop).toBe(250);
  });
  test('upward drift (first line scrolled above) scrolls back up', () => {
    let top = 105;
    const v = fake('a', 0, () => top);
    const before = caretOffset(v)!;
    top = 75;
    v.scrollDOM.scrollTop = 30;
    restoreCaretOffset(v, before);
    expect(v.scrollDOM.scrollTop).toBe(0);
  });
  test('no move when the offset is unchanged', () => {
    const v = fake('a', 0, () => 120);
    expect(restoreCaretOffset(v, 20)).toBe(false);
  });
});
