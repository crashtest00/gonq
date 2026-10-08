import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
  const files: FileAccess = { pickDocument: async () => d, loadImage: async () => null, saveDocument: async (x) => ({ name: x.name, path: x.path }), saveDocumentAs: async (x) => ({ name: x.name, path: null }) };
  return files;
}

async function openDoc(text: string) {
  const user = userEvent.setup();
  render(<App files={open(text)} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
  await screen.findByTestId('markdown-view');
  return user;
}

const DOC = `Para one [💬](#md-thread-${A}) here.

Para two [✅](#md-thread-${B}) there.

${block(A, 'open', 'Where does this number come from?', { anchor: 'holds through Q3', author: 'architect-agent:75a079f6' })}

${block(B, 'resolved', 'Second thread body that is definitely longer than fifty characters in total.')}
`;

test('markers render the literal glyph and are clickable', async () => {
  await openDoc(DOC);
  const open_ = screen.getByRole('button', { name: '💬' });
  const done = screen.getByRole('button', { name: '✅' });
  expect(open_.textContent).toBe('💬');
  expect(done.textContent).toBe('✅');
  expect(open_.querySelector('svg, img')).toBeNull();
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

test('marker click opens the thread and scrolls the marker ~40px from the top', async () => {
  const user = await openDoc(DOC);
  const main = document.querySelector('main') as HTMLElement;
  main.getBoundingClientRect = () => ({ top: 100 }) as DOMRect;
  const marker = screen.getByRole('button', { name: '✅' });
  marker.getBoundingClientRect = () => ({ top: 700 }) as DOMRect;
  main.scrollTop = 0;
  await user.click(marker);
  expect(main.scrollTop).toBe(560);
  const side = screen.getByRole('complementary', { name: 'Comments' });
  expect(within(side).getByText('Resolved')).toBeInTheDocument();
  expect(within(side).getByText('User')).toBeInTheDocument();
});

test('thread view shows author as written, anchor, and closes back to the list', async () => {
  const user = await openDoc(DOC);
  await user.click(screen.getByRole('button', { name: '💬' }));
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
  expect(screen.getByText(/Second thread body/)).toBeInTheDocument();
});

test('no resolve, edit or delete controls; only a reply box', async () => {
  const user = await openDoc(DOC);
  await user.click(screen.getByRole('button', { name: '💬' }));
  expect(screen.getAllByRole('textbox')).toHaveLength(1);
  expect(screen.getByRole('textbox', { name: 'Reply' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /edit|delete|save|submit/i })).toBeNull();
});

test('malformed block is skipped and the file still opens', async () => {
  const user = await openDoc(`Text [💬](#md-thread-${A}).\n\n<!--\n@thread ${B}\n\n[User | x]\nno status\n-->\n\n${block(A, 'open', 'ok')}\n`);
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
});

test('dangling marker renders the glyph and does nothing on click', async () => {
  const user = await openDoc(`Text [💬](#md-thread-${A}) end.\n`);
  await user.click(screen.getByText('💬'));
  expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: '💬' })).toBeNull();
});

test('thread without a marker is listed and opens without scrolling', async () => {
  const user = await openDoc(`No marker here.\n\n${block(A, 'open', 'orphan body')}\n`);
  const main = document.querySelector('main') as HTMLElement;
  main.scrollTop = 7;
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(within(screen.getByRole('list')).getByRole('button'));
  expect(screen.getByText('orphan body')).toBeInTheDocument();
  expect(main.scrollTop).toBe(7);
});

test('same-id blocks pair with markers by ordinal', async () => {
  const user = await openDoc(
    `First [💬](#md-thread-${A}) and second [💬](#md-thread-${A}).\n\n${block(A, 'open', 'first body')}\n\n${block(A, 'open', 'second body')}\n`,
  );
  const [m1, m2] = screen.getAllByRole('button', { name: '💬' });
  await user.click(m2);
  expect(screen.getByText('second body')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Close thread' }));
  await user.click(m1);
  expect(screen.getByText('first body')).toBeInTheDocument();
});

test('escaped --\\> displays as -->', async () => {
  const user = await openDoc(`X [💬](#md-thread-${A}).\n\n${block(A, 'open', 'a --\\> b')}\n`);
  await user.click(screen.getByRole('button', { name: '💬' }));
  expect(screen.getByText('a --> b')).toBeInTheDocument();
});

test('a thread block indented in a list item parses and stays hidden', async () => {
  const user = await openDoc(`- item [💬](#md-thread-${A})\n\n${block(A, 'open', 'nested body', { indent: '  ' })}\n`);
  const view = screen.getByTestId('markdown-view');
  expect(view).not.toHaveTextContent('nested body');
  await user.click(screen.getByRole('button', { name: '💬' }));
  expect(screen.getByText('nested body')).toBeInTheDocument();
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
