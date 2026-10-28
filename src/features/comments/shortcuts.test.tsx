/** Comment shortcuts: Alt+M adds a comment at the selection or caret, Ctrl/Cmd+Enter saves in the new-comment, reply and edit boxes. */
import { fireEvent, screen } from '@testing-library/react';
import { vi } from 'vitest';
import { openDocument, renderApp, testDoc } from '../../testing/renderApp';
import { caretAt, docText, selectText } from '../../testing/editor';

vi.setConfig({ testTimeout: 30000 });

async function setup() {
  const { user } = renderApp({ docs: [testDoc('# Title\n\nThe estimate holds.\n')] });
  await openDocument(user);
  return user;
}
const altM = (over: object = {}) => fireEvent.keyDown(window, { key: 'm', code: 'KeyM', altKey: true, ...over });

test('Alt+M opens a comment draft on the selection, also when macOS Option changes the key', async () => {
  await setup();
  selectText('estimate');
  altM({ key: 'µ' });
  expect(screen.getByText('New comment')).toBeInTheDocument();
});

test('Alt+M does nothing where a comment cannot go, and Alt+Shift+M is not the shortcut', async () => {
  await setup();
  caretAt('Title');
  altM();
  expect(screen.queryByText('New comment')).toBeNull();
  caretAt('estimate');
  altM({ shiftKey: true });
  expect(screen.queryByText('New comment')).toBeNull();
});

test('Ctrl+Enter submits the draft, Cmd+Enter saves a reply and an edit', async () => {
  const user = await setup();
  caretAt('estimate');
  altM();
  const box = screen.getByRole('textbox', { name: 'Comment' });
  await user.type(box, 'first');
  fireEvent.keyDown(box, { key: 'Enter' });
  expect(screen.getByRole('textbox', { name: 'Comment' })).toBeInTheDocument();
  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
  expect(await screen.findByText('first')).toBeInTheDocument();
  expect(docText()).toContain('md-thread-');

  const reply = screen.getByRole('textbox', { name: 'Reply' });
  await user.type(reply, 'second');
  fireEvent.keyDown(reply, { key: 'Enter', metaKey: true });
  expect(await screen.findByText('second')).toBeInTheDocument();
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveValue('');

  await user.click(screen.getAllByRole('button', { name: /edit/i })[0]);
  const edit = screen.getByRole('textbox', { name: 'Edit comment' });
  await user.clear(edit);
  await user.type(edit, 'changed');
  fireEvent.keyDown(edit, { key: 'Enter', ctrlKey: true });
  expect(await screen.findByText('changed')).toBeInTheDocument();
  expect(screen.queryByRole('textbox', { name: 'Edit comment' })).toBeNull();
});

test('the right-click Add Comment item shows Alt+M', async () => {
  const user = await setup();
  caretAt('estimate');
  fireEvent.contextMenu(document.querySelector('.cm-content')!);
  expect(await screen.findByRole('menuitem', { name: /Add Comment/ })).toHaveTextContent('Alt+M');
  await user.keyboard('{Escape}');
});

test('Alt+M with a draft open focuses it and keeps the typed text; a held key does not repeat', async () => {
  const user = await setup();
  caretAt('estimate');
  altM();
  const box = screen.getByRole('textbox', { name: 'Comment' });
  await user.type(box, 'keep me');
  box.blur();
  altM();
  expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveValue('keep me');
  expect(screen.getByRole('textbox', { name: 'Comment' })).toHaveFocus();
  box.blur();
  altM({ repeat: true });
  expect(screen.getByRole('textbox', { name: 'Comment' })).not.toHaveFocus();
});

test('empty and whitespace-only bodies are not saved; rapid Ctrl+Enter saves one thread; IME and repeat are ignored', async () => {
  const user = await setup();
  caretAt('estimate');
  altM();
  const box = screen.getByRole('textbox', { name: 'Comment' });
  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
  await user.type(box, '   ');
  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
  expect(docText()).not.toContain('md-thread-');
  await user.type(box, 'once');
  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, isComposing: true });
  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true, repeat: true });
  expect(docText()).not.toContain('md-thread-');
  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(box, { key: 'Enter', ctrlKey: true });
  fireEvent.keyDown(box, { key: 'Enter', metaKey: true });
  expect(await screen.findByText('once')).toBeInTheDocument();
  expect(docText().match(/md-thread-/g)?.length ?? 0).toBeLessThanOrEqual(2);
  expect(screen.getAllByText('once')).toHaveLength(1);
});

test('the comment boxes and buttons name their shortcut in a tooltip and aria-keyshortcuts', async () => {
  const user = await setup();
  caretAt('estimate');
  altM();
  const box = screen.getByRole('textbox', { name: 'Comment' });
  expect(box).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
  expect(box).toHaveAttribute('title', expect.stringContaining('Ctrl+Enter'));
  expect(screen.getByRole('button', { name: 'Submit' })).toHaveAttribute('title', expect.stringContaining('Cmd+Enter'));
  await user.type(box, 'x');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(screen.getByRole('button', { name: 'Reply' })).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
  expect(screen.getByRole('textbox', { name: 'Reply' })).toHaveAttribute('title', expect.stringContaining('Ctrl+Enter'));
});

test('Alt+M does nothing in a tab with no document selection state for a comment', async () => {
  renderApp({ docs: [testDoc('# Title\n\nThe estimate holds.\n')] });
  altM();
  expect(screen.queryByText('New comment')).toBeNull();
});
