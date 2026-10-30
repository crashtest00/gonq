/** The editor right-click menu: Add Comment, Cut/Copy/Paste, Select All, Bold/Italic. */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { caretAt, docText, editorView, selectText } from '@gonq/editor/testing/editor';
import App from '../App';
import type { FileAccess } from '@gonq/editor/platform/files';

vi.setConfig({ testTimeout: 30000 });

const DOC = '# Title\n\nThe estimate holds.\n\nSecond paragraph.\n';

async function openDoc() {
  // jsdom has no layout: pretend the pointer is over the current selection head.
  vi.spyOn(EditorView.prototype, 'posAtCoords').mockImplementation(function (this: EditorView) {
    return this.state.selection.main.head;
  } as never);
  const user = userEvent.setup();
  const files: FileAccess = {
    pickDocument: async () => ({ name: 'a.md', path: '/d/a.md', text: DOC }),
    saveDocument: async (d) => ({ name: d.name, path: d.path }),
    saveDocumentAs: async (d) => ({ name: d.name, path: null }),
  };
  render(<App files={files} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  await screen.findByTestId('editor');
  return user;
}

const openMenu = () => fireEvent.contextMenu(document.querySelector('.cm-content')!, { clientX: 10, clientY: 10 });
const item = (name: string) => screen.getByRole('menuitem', { name });

test('right-click opens the menu with Add Comment enabled on a selection; picking it opens a draft', async () => {
  const user = await openDoc();
  selectText('estimate');
  openMenu();
  expect(screen.getByRole('menu', { name: 'Editor' })).toBeInTheDocument();
  expect(item('Cut')).toBeEnabled();
  await user.click(item('Add Comment'));
  expect(screen.queryByRole('menu')).toBeNull();
  expect(screen.getByText('New comment')).toBeInTheDocument();
});

test('Add Comment is disabled in a heading, Cut and Copy without a selection; Escape closes', async () => {
  const user = await openDoc();
  caretAt('Title');
  openMenu();
  expect(item('Add Comment')).toBeDisabled();
  expect(item('Cut')).toBeDisabled();
  expect(item('Copy')).toBeDisabled();
  await user.keyboard('{Escape}');
  expect(screen.queryByRole('menu')).toBeNull();
});

test('Bold wraps the selection; Select All selects the document', async () => {
  const user = await openDoc();
  selectText('estimate');
  openMenu();
  await user.click(item('Bold'));
  expect(docText()).toContain('**estimate**');
  openMenu();
  await user.click(item('Select All'));
  const sel = editorView().state.selection.main;
  expect(sel.to - sel.from).toBe(docText().length);
});

test('Cut removes the selection and puts it on the clipboard', async () => {
  const user = await openDoc();
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  selectText('estimate');
  openMenu();
  await user.click(item('Cut'));
  expect(writeText).toHaveBeenCalledWith('estimate');
  await vi.waitFor(() => expect(docText()).toContain('The  holds.'));
});
