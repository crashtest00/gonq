import { EditorView } from '@codemirror/view';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import { preview, relativeTime } from './threads';
import type { FileAccess, OpenedDocument } from '../platform/files';

const block = (id: string, status: string, body: string, opts: { anchor?: string; author?: string; indent?: string } = {}) =>
  [
    '<!--',
    `@thread ${id}`,
    `@status ${status}`,
    ...(opts.anchor ? [`@anchor ${opts.anchor}`] : []),
    '',
    `[${opts.author ?? 'User'} | 2026-09-10T14:30:22+02:00]`,
    body,
    '-->',
  ]
    .map((l) => (opts.indent ?? '') + l)
    .join('\n');

const A = 'c20260910143022a3f9c1';
const B = 'c20260910143022a3f9c2';

function open(text: string) {
  const d: OpenedDocument = { name: 'a.md', path: '/d/a.md', text };
  const files: FileAccess = { pickDocument: async () => d, saveDocument: async (x) => ({ name: x.name, path: x.path }), saveDocumentAs: async (x) => ({ name: x.name, path: null }) };
  return files;
}

async function openDoc(text: string) {
  const user = userEvent.setup();
  render(<App files={open(text)} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  await screen.findByTestId('editor');
  return user;
}

const DOC = `Para one [💬](#md-thread-${A}) here.

Para two [✅](#md-thread-${B}) there.

${block(A, 'open', 'Where does this number come from?', { anchor: 'holds through Q3', author: 'architect-agent:75a079f6' })}

${block(B, 'resolved', 'Second thread body that is definitely longer than fifty characters in total.')}
`;

test('formatted mode shows markers as glyphs and hides the thread blocks; Raw shows the source', async () => {
  const user = await openDoc(DOC);
  const editor = screen.getByTestId('editor');
  await waitFor(() => expect(editor.querySelectorAll('.cm-thread-marker')).toHaveLength(2), { timeout: 10000 });
  expect(editor.textContent).toContain('Para one 💬 here.');
  expect(editor.textContent).toContain('Para two ✅ there.');
  expect(editor.textContent).not.toContain('@thread');
  await user.click(screen.getByRole('switch', { name: /raw/i }));
  await waitFor(() => expect(editor.textContent).toContain(`[💬](#md-thread-${A})`), { timeout: 10000 });
  expect(editor.textContent).toContain(`[✅](#md-thread-${B})`);
  expect(editor.textContent).toContain('@thread ' + A);
});

test('clicking a marker opens that thread in the sidebar', async () => {
  const user = await openDoc(DOC);
  const editor = screen.getByTestId('editor');
  await waitFor(() => expect(editor.querySelectorAll('.cm-thread-marker')).toHaveLength(2), { timeout: 10000 });
  await user.click(editor.querySelectorAll('.cm-thread-marker')[1]);
  expect(await screen.findByRole('button', { name: 'Close thread' })).toBeInTheDocument();
  expect(screen.getByText(/Second thread body/)).toBeInTheDocument();
});

test('toggle shows/hides the sidebar and reopening shows All threads', async () => {
  const user = await openDoc(DOC);
  expect(screen.queryByRole('complementary', { name: 'Comments' })).not.toBeInTheDocument();
  const toggle = screen.getByRole('button', { name: 'Comments' });
  await user.click(toggle);
  const side = screen.getByRole('complementary', { name: 'Comments' });
  expect(side).toHaveClass('w-[340px]');
  await user.click(within(within(side).getByRole('list')).getAllByRole('button')[0]);
  expect(screen.getByRole('button', { name: 'Close thread' })).toBeInTheDocument();
  await user.click(toggle);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  await user.click(toggle);
  expect(screen.getByRole('heading', { name: 'Comments' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Close thread' })).not.toBeInTheDocument();
});

test('list shows every thread in document order with badge, anchor only if present, preview', async () => {
  const user = await openDoc(DOC);
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  const rows = within(screen.getByRole('list')).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('Open');
  expect(rows[0]).toHaveTextContent('holds through Q3');
  expect(rows[0]).toHaveTextContent('Where does this number come from?');
  expect(rows[1]).toHaveTextContent('Resolved');
  expect(rows[1].querySelector('blockquote')).toBeNull();
  expect(rows[1]).toHaveTextContent('Second thread body that is definitely longer than …');
});

test('empty state', async () => {
  const user = await openDoc('Just text.\n');
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  expect(screen.getByText('No comments yet.')).toBeInTheDocument();
});

test('opening a thread from the list scrolls its marker into view', async () => {
  const user = await openDoc(DOC);
  const scroll = vi.spyOn(EditorView, 'scrollIntoView');
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(within(screen.getByRole('list')).getAllByRole('button')[1]);
  expect(scroll).toHaveBeenCalledWith(DOC.indexOf(`[✅](#md-thread-${B})`), expect.anything());
  scroll.mockRestore();
  const side = screen.getByRole('complementary', { name: 'Comments' });
  expect(within(side).getByText('Resolved')).toBeInTheDocument();
  expect(within(side).getByText('User')).toBeInTheDocument();
});

const openFirst = async (user: ReturnType<typeof userEvent.setup>, n = 0) => {
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(within(screen.getByRole('list')).getAllByRole('button')[n]);
};

test('thread view shows author as written, anchor, and closes back to the list', async () => {
  const user = await openDoc(DOC);
  await openFirst(user);
  const side = screen.getByRole('complementary', { name: 'Comments' });
  expect(within(side).getByText('architect-agent:75a079f6')).toBeInTheDocument();
  expect(within(side).queryByText('You')).toBeNull();
  expect(side).toHaveTextContent('holds through Q3');
  await user.click(within(side).getByRole('button', { name: 'Close thread' }));
  expect(within(side).getByRole('heading', { name: 'Comments' })).toBeInTheDocument();
});

test('list row click opens the thread', async () => {
  const user = await openDoc(DOC);
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(within(screen.getByRole('list')).getAllByRole('button')[1]);
  expect(screen.getByRole('button', { name: 'Close thread' })).toBeInTheDocument();
  expect(within(screen.getByRole('complementary', { name: 'Comments' })).getByText(/Second thread body/)).toBeInTheDocument();
});

test('edit and delete controls are offered; only a reply box is open for typing', async () => {
  const user = await openDoc(DOC);
  await openFirst(user);
  const side = within(screen.getByRole('complementary', { name: 'Comments' }));
  expect(side.getAllByRole('textbox')).toHaveLength(1);
  expect(side.getByRole('textbox', { name: 'Reply' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Edit thread' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Delete thread' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /^(save|submit)$/i })).toBeNull();
});

test('malformed block is skipped and the file still opens', async () => {
  const user = await openDoc(`Text [💬](#md-thread-${A}).\n\n<!--\n@thread ${B}\n\n[User | x]\nno status\n-->\n\n${block(A, 'open', 'ok')}\n`);
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
});

test('dangling marker is plain source and the sidebar stays closed', async () => {
  await openDoc(`Text [💬](#md-thread-${A}) end.\n`);
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(screen.getByTestId('editor').textContent).toContain('💬');
});

test('thread without a marker is listed and opens without moving the caret', async () => {
  const user = await openDoc(`No marker here.\n\n${block(A, 'open', 'orphan body')}\n`);
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(within(screen.getByRole('list')).getByRole('button'));
  expect(within(screen.getByRole('complementary', { name: 'Comments' })).getByText('orphan body')).toBeInTheDocument();
});

test('same-id blocks pair with markers by ordinal', async () => {
  const user = await openDoc(
    `First [💬](#md-thread-${A}) and second [💬](#md-thread-${A}).\n\n${block(A, 'open', 'first body')}\n\n${block(A, 'open', 'second body')}\n`,
  );
  const side = () => within(screen.getByRole('complementary', { name: 'Comments' }));
  await openFirst(user, 1);
  expect(side().getByText('second body')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close thread' }));
  await user.click(within(screen.getByRole('list')).getAllByRole('button')[0]);
  expect(side().getByText('first body')).toBeInTheDocument();
});

test('escaped --\\> displays as -->', async () => {
  const user = await openDoc(`X [💬](#md-thread-${A}).\n\n${block(A, 'open', 'a --\\> b')}\n`);
  await openFirst(user);
  expect(within(screen.getByRole('complementary', { name: 'Comments' })).getByText('a --> b')).toBeInTheDocument();
});

test('a thread block indented in a list item parses and is listed', async () => {
  const user = await openDoc(`- item [💬](#md-thread-${A})\n\n${block(A, 'open', 'nested body', { indent: '  ' })}\n`);
  await openFirst(user);
  expect(within(screen.getByRole('complementary', { name: 'Comments' })).getByText('nested body')).toBeInTheDocument();
});

test('relative time and preview helpers', () => {
  const now = Date.parse('2026-09-10T12:00:00Z');
  expect(relativeTime('2026-09-10T11:59:50Z', now)).toBe('just now');
  expect(relativeTime('2026-09-10T11:55:00Z', now)).toBe('5m ago');
  expect(relativeTime('2026-09-10T10:00:00Z', now)).toBe('2h ago');
  expect(relativeTime('2026-09-07T12:00:00Z', now)).toBe('3d ago');
  expect(relativeTime('garbage', now)).toBe('garbage');
  expect(preview('x'.repeat(60))).toBe(`${'x'.repeat(50)}…`);
  expect(preview('short')).toBe('short');
});

test('a CRLF document lists its threads as the LF one does', async () => {
  const user = await openDoc(DOC.replace(/\r?\n/g, '\r\n'));
  expect(screen.getByTestId('editor').textContent).toContain('💬');
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  const rows = within(screen.getByRole('list')).getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0]).toHaveTextContent('holds through Q3');
  expect(rows[0]).toHaveTextContent('Where does this number come from?');
  expect(rows[1]).toHaveTextContent('Resolved');
});
