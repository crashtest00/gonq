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
