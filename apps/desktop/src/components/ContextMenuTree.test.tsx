/** Pins the editor right-click menu (labels, order, separators, enabled state) in every editing state, with the platform both native and web. */
import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { openDocument, renderApp, testDoc } from '../testing/renderApp';
import { caretAt, selectText, settleEditors, editorView } from '@gonq/editor/testing/editor';

const state = vi.hoisted(() => ({ tauri: false }));
vi.mock('@gonq/editor/platform/tauri', () => ({ isTauri: () => state.tauri }));
vi.setConfig({ testTimeout: 60000 });

const DOC = [
  '# Title',
  '',
  'The estimate holds, see [the link](https://example.com).',
  '',
  '| A | B |',
  '| - | - |',
  '| cell one | cell two |',
  '',
  '- item one',
  '- [ ] task one',
  '',
  '```js',
  'const code = 1;',
  '```',
  '',
].join('\n');

/** The open menu as text: one line per item, `---` for a separator, `(disabled)` for a greyed item. */
function dump(): string[] {
  const m = screen.getByRole('menu', { name: 'Editor' });
  const out: string[] = [];
  for (const el of Array.from(m.querySelectorAll('[role="menuitem"], [role="separator"]'))) {
    out.push(el.getAttribute('role') === 'separator' ? '---' : `${el.textContent}${(el as HTMLButtonElement).disabled ? ' (disabled)' : ''}`);
  }
  return out;
}

async function capture(): Promise<Record<string, string[]>> {
  vi.spyOn(EditorView.prototype, 'posAtCoords').mockImplementation(function (this: EditorView) {
    return this.state.selection.main.head;
  } as never);
  const { user } = renderApp({ docs: [testDoc(DOC)] });
  await openDocument(user);
  settleEditors();
  const states: Record<string, string[]> = {};
  const open = async (name: string, place: () => void) => {
    place();
    fireEvent.contextMenu(document.querySelector('.cm-content')!, { clientX: 10, clientY: 10 });
    states[name] = dump();
    await user.keyboard('{Escape}');
  };
  await open('paragraph', () => caretAt('estimate'));
  await open('selection', () => selectText('estimate'));
  await open('heading', () => caretAt('Title'));
  await open('table cell', () => caretAt('cell one'));
  await open('list item', () => caretAt('item one'));
  await open('task item', () => caretAt('task one'));
  await open('link', () => caretAt('the link'));
  await open('fenced code', () => caretAt('const code'));
  await open('outside the selection', () => {
    selectText('estimate');
    // the pointer lands elsewhere: the caret moves there
    const v = editorView();
    vi.spyOn(v, 'posAtCoords').mockReturnValueOnce(v.state.doc.toString().indexOf('Title'));
  });
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  await user.click(await screen.findByRole('menuitemcheckbox', { name: /Raw Markdown/ }));
  await open('raw, no selection', () => caretAt('estimate'));
  await open('raw, selection', () => selectText('estimate'));
  return states;
}

test('the right-click menu is the same in every state, native or web', async () => {
  state.tauri = false;
  const web = await capture();
  expect(web).toMatchSnapshot();
  document.body.innerHTML = '';
  state.tauri = true;
  // Enough of the Tauri bridge that its window and event APIs resolve instead of throwing.
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
    invoke: async () => [],
    transformCallback: () => 0,
  };
  (window as unknown as Record<string, unknown>).__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: () => {} };
  const native = await capture();
  expect(native).toEqual(web);
});
