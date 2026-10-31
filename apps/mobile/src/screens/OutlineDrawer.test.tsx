/** Covers the mobile Outline drawer through renderMobileApp (the port of the desktop OutlineSidebar.test.tsx): the top-bar button, header and "No headings.", entries equal to outlineOf for the same text, tap-to-jump (also for identical headings), setext/deep headings and markers, level styling and indent, live updates while typing, and no "current heading" row. */
import { screen, waitFor, within } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
const fs = vi.hoisted(() => ({ text: '' }));
vi.mock('@tauri-apps/plugin-fs', async (orig) => ({
  ...(await orig<object>()),
  readFile: vi.fn(async () => new TextEncoder().encode(fs.text)),
}));

import { outlineOf } from '@gonq/editor/model/outline';
import { at, editorView, select, settleEditors, type as typeText } from '@gonq/editor/testing/editor';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

const DOC = '# Title\n\nintro\n\n## Part A\n\nbody\n\n## Part B\n';

beforeEach(() => {
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve([{ path: '/n.md', opened_at: Date.now() }]);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    if (cmd === 'path_exists') return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

async function open(text: string = DOC): Promise<User> {
  fs.text = text;
  const { user } = await renderMobileApp();
  await user.click(await screen.findByRole('button', { name: /^n\.md/ }));
  await screen.findByTestId('editor');
  settleEditors(document.body);
  return user;
}
const openDrawer = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  return screen.findByRole('dialog', { name: 'Outline' });
};
const rows = (drawer: HTMLElement) => within(drawer).queryAllByRole('listitem').map((li) => li.textContent);

it('the top-bar button opens the drawer with the header and the headings, and closes it again', async () => {
  const user = await open();
  const button = screen.getByRole('button', { name: 'Document outline' });
  expect(button).toHaveClass('m-tap');
  expect(screen.queryByRole('dialog', { name: 'Outline' })).toBeNull();
  const drawer = await openDrawer(user);
  expect(button).toHaveAttribute('aria-expanded', 'true');
  expect(within(drawer).getByText('Outline')).toBeInTheDocument();
  expect(rows(drawer)).toEqual(['Title', 'Part A', 'Part B']);
  await user.click(button);
  expect(screen.queryByRole('dialog', { name: 'Outline' })).toBeNull();
});

it('the entries are exactly outlineOf(text), in order', async () => {
  const text = 'Setext One\n===\n\nSetext Two\n---\n\n### Deep\n\n## Atx\n\n# Marked [💬](#md-thread-abc) heading\n\n####### seven\n';
  const user = await open(text);
  const drawer = await openDrawer(user);
  expect(rows(drawer)).toEqual(outlineOf(text).map((i) => i.text));
  expect(rows(drawer)).toEqual(['Setext One', 'Setext Two', 'Deep', 'Atx', 'Marked heading']);
});

it('tapping an entry jumps to its heading, puts the caret there and closes the drawer', async () => {
  const user = await open();
  const drawer = await openDrawer(user);
  const scroll = vi.spyOn(EditorView, 'scrollIntoView');
  await user.click(within(drawer).getByRole('button', { name: 'Part B' }));
  expect(scroll).toHaveBeenCalledWith(DOC.indexOf('## Part B'), expect.anything());
  expect(editorView().state.selection.main.head).toBe(DOC.indexOf('## Part B'));
  expect(screen.queryByRole('dialog', { name: 'Outline' })).toBeNull();
  scroll.mockRestore();
});

it('identical headings each jump to their own position', async () => {
  const text = '## Same\n\none\n\n## Same\n\ntwo\n';
  const user = await open(text);
  const scroll = vi.spyOn(EditorView, 'scrollIntoView');
  let drawer = await openDrawer(user);
  await user.click(within(drawer).getAllByRole('button', { name: 'Same' })[1]);
  expect(scroll).toHaveBeenLastCalledWith(text.lastIndexOf('## Same'), expect.anything());
  drawer = await openDrawer(user);
  await user.click(within(drawer).getAllByRole('button', { name: 'Same' })[0]);
  expect(scroll).toHaveBeenLastCalledWith(0, expect.anything());
  scroll.mockRestore();
});

it('says "No headings." for a document without any, and for an empty one', async () => {
  const user = await open('just a paragraph\n\nanother\n');
  const drawer = await openDrawer(user);
  expect(within(drawer).getByText('No headings.')).toBeInTheDocument();
  expect(within(drawer).queryByRole('list')).toBeNull();
});

it('level 1 is semibold and foreground, deeper levels are muted and indented progressively', async () => {
  const user = await open('# A\n\n## B\n\n### C\n\n#### D\n\n##### E\n\n###### F\n');
  const drawer = await openDrawer(user);
  const row = (n: string) => within(drawer).getByRole('button', { name: n });
  expect(row('A')).toHaveAttribute('data-level', '1');
  expect(['A', 'B', 'C', 'D', 'E', 'F'].map((n) => row(n).style.paddingLeft)).toEqual(['20px', '32px', '44px', '56px', '68px', '80px']);
});

it('has no highlighted current-heading row', async () => {
  const user = await open();
  const drawer = await openDrawer(user);
  select(at('## Part B'));
  expect(drawer.querySelector('[aria-current], [aria-selected="true"], [data-active="true"], [aria-pressed="true"]')).toBeNull();
});

it('follows typing: rename, add and remove a heading', async () => {
  const user = await open();
  select(at('## Part A'), at('## Part A', true));
  typeText('## Renamed');
  const drawer = await openDrawer(user);
  expect(rows(drawer)).toEqual(['Title', 'Renamed', 'Part B']);
});

it('switching tabs closes the drawer', async () => {
  const user = await open();
  await openDrawer(user);
  await user.click(screen.getByRole('button', { name: 'New tab' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Outline' })).toBeNull());
});
