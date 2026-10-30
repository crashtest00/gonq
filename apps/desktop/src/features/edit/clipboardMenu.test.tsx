/** Editor right-click menu actions: Copy, Paste, Italic, a rejected clipboard operation in the error banner, and Add Comment on a caret. */
import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { EditorView } from '@codemirror/view';
import { openDocument, renderApp, testDoc } from '../../testing/renderApp';
import { caretAt, docText, selectText } from '@gonq/editor/testing/editor';

vi.setConfig({ testTimeout: 30000 });

async function setup() {
  vi.spyOn(EditorView.prototype, 'posAtCoords').mockImplementation(function (this: EditorView) {
    return this.state.selection.main.head;
  } as never);
  const { user } = renderApp({ docs: [testDoc('# Title\n\nThe estimate holds.\n')] });
  await openDocument(user);
  return user;
}
const openMenu = () => fireEvent.contextMenu(document.querySelector('.cm-content')!, { clientX: 10, clientY: 10 });
const pick = (name: string) => screen.getByRole('menuitem', { name });
const clipboard = (c: object) => Object.defineProperty(navigator, 'clipboard', { value: c, configurable: true });

test('Copy puts the selection on the clipboard and leaves the text', async () => {
  const user = await setup();
  const writeText = vi.fn().mockResolvedValue(undefined);
  clipboard({ writeText });
  selectText('estimate');
  openMenu();
  await user.click(pick('Copy'));
  expect(writeText).toHaveBeenCalledWith('estimate');
  expect(docText()).toContain('The estimate holds.');
});

test('Paste inserts the clipboard text at the caret', async () => {
  const user = await setup();
  clipboard({ readText: vi.fn().mockResolvedValue('NEW ') });
  caretAt('The ');
  openMenu();
  await user.click(pick('Paste'));
  await vi.waitFor(() => expect(docText()).toContain('The NEW estimate'));
});

test('Italic wraps the selection', async () => {
  const user = await setup();
  selectText('estimate');
  openMenu();
  await user.click(pick('Italic'));
  expect(docText()).toMatch(/([*_])estimate\1/);
});

test('a rejected clipboard operation shows its message in the error banner', async () => {
  const user = await setup();
  clipboard({ writeText: vi.fn().mockRejectedValue(new Error('clipboard blocked')) });
  selectText('estimate');
  openMenu();
  await user.click(pick('Copy'));
  expect(await screen.findByText('Clipboard access was denied; use Ctrl+C.')).toBeInTheDocument();
});

test('Add Comment on a commentable caret without a selection opens a draft', async () => {
  const user = await setup();
  caretAt('estimate');
  openMenu();
  expect(pick('Add Comment')).toBeEnabled();
  await user.click(pick('Add Comment'));
  expect(screen.getByText('New comment')).toBeInTheDocument();
});
