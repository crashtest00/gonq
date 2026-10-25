import { undo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';
import { createEditorState } from './extensions';

// Browsers blur a focused cell while its widget is being removed by a redraw, in the middle of the view
// update; jsdom does not, so removal is made to do it.
test('Tab out of an edited cell and undo do not throw while the focused cell is redrawn away', async () => {
  const removeChild = Node.prototype.removeChild;
  Node.prototype.removeChild = function <T extends Node>(this: Node, c: T): T {
    const a = document.activeElement;
    if (a && c.contains(a)) {
      a.dispatchEvent(new FocusEvent('blur'));
      a.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    }
    return removeChild.call(this, c) as T;
  };
  const errors: unknown[] = [];
  const onError = (e: ErrorEvent) => errors.push(e.error);
  window.addEventListener('error', onError);
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ state: createEditorState('| h | i |\n| - | - |\n| a | b |', false), parent });
  try {
    const td = view.contentDOM.querySelectorAll<HTMLElement>('td')[0];
    td.focus();
    td.textContent = 'zz';
    td.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toContain('| zz | b |');
    undo(view);
    expect(view.state.doc.toString()).toContain('| a | b |');
    await new Promise((r) => setTimeout(r, 20));
    expect(errors).toEqual([]);
  } finally {
    Node.prototype.removeChild = removeChild;
    window.removeEventListener('error', onError);
    view.destroy();
    parent.remove();
  }
});
