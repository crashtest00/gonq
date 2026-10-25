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

test('Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y pressed in a cell undo and redo the document one edit at a time', () => {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ state: createEditorState('| h | i |\n| - | - |\n| a | b |', false), parent });
  const cells = () => view.contentDOM.querySelectorAll<HTMLElement>('td');
  const key = (k: string, o: KeyboardEventInit = {}) => {
    cells()[1].focus();
    cells()[1].dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  };
  try {
    cells()[0].focus();
    cells()[0].textContent = 'xyz';
    cells()[0].dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true }));
    expect(view.state.doc.toString()).toContain('| xyz | b |');
    key('z', { ctrlKey: true });
    expect(view.state.doc.toString()).toContain('| a | b |');
    key('z', { ctrlKey: true, shiftKey: true });
    expect(view.state.doc.toString()).toContain('| xyz | b |');
    key('z', { ctrlKey: true });
    expect(view.state.doc.toString()).toContain('| a | b |');
    key('y', { ctrlKey: true });
    expect(view.state.doc.toString()).toContain('| xyz | b |');
    expect(view.contentDOM.querySelectorAll('table').length).toBe(1);
  } finally {
    view.destroy();
    parent.remove();
  }
});

test('one Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y in a cell is exactly one step with earlier edits in history', () => {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({ state: createEditorState('| a | b |\n| - | - |\n| c | d |', false), parent });
  const errors: unknown[] = [];
  const onErr = (e: ErrorEvent) => errors.push(e.error);
  window.addEventListener('error', onErr);
  const cells = () => view.contentDOM.querySelectorAll<HTMLElement>('th, td');
  const doc = () => view.state.doc.toString();
  const keyOn = (td: HTMLElement, k: string, o: KeyboardEventInit = {}) => {
    td.focus();
    td.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true, ...o }));
  };
  try {
    cells()[0].focus();
    cells()[0].textContent = 'aX';
    keyOn(cells()[0], 'Escape');
    cells()[3].focus();
    cells()[3].textContent = 'dY';
    keyOn(cells()[3], 'Escape');
    cells()[1].focus();
    cells()[1].textContent = 'bZ';
    keyOn(cells()[1], 'Tab');
    expect(doc()).toContain('| aX | bZ |');
    keyOn(cells()[2], 'z', { ctrlKey: true });
    expect(doc()).toContain('| aX | b |');
    expect(doc()).toContain('| c | dY |');
    keyOn(cells()[2], 'z', { ctrlKey: true, shiftKey: true });
    expect(doc()).toContain('| aX | bZ |');
    keyOn(cells()[2], 'z', { ctrlKey: true });
    keyOn(cells()[2], 'y', { ctrlKey: true });
    expect(doc()).toContain('| aX | bZ |');
    expect(doc()).toContain('| c | dY |');
    // Ctrl+Z while still typing: only the typed edit is lost.
    cells()[2].focus();
    cells()[2].textContent = 'cQ';
    keyOn(cells()[2], 'z', { ctrlKey: true });
    expect(doc()).toContain('| c | dY |');
    expect(doc()).toContain('| aX | bZ |');
    expect(errors).toEqual([]);
  } finally {
    window.removeEventListener('error', onErr);
    view.destroy();
    parent.remove();
  }
});
