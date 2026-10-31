/** Covers the mobile tab strip through renderMobileApp (the port of the desktop Tabs.test.tsx): one tab per document, switching, the unsaved "●" only on dirty tabs, same-name labels, "+" = File > New, Close on every tab, a dirty tab always asking before it closes, the 44px classes and that the Outline/Comments buttons are not registry commands. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
const fs = vi.hoisted(() => ({ texts: {} as Record<string, string>, written: [] as [string, string][] }));
vi.mock('@tauri-apps/plugin-fs', async (orig) => ({
  ...(await orig<object>()),
  readFile: vi.fn(async (path: string) => new TextEncoder().encode(fs.texts[path] ?? '')),
  writeTextFile: vi.fn(async (path: string, text: string) => void fs.written.push([path, text])),
}));

import { registry } from '@gonq/editor/commands';
import { caretAt, select, settleEditors, type as typeText } from '@gonq/editor/testing/editor';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

const NOW = Date.now();
let recents: { path: string; opened_at: number }[] = [];

beforeEach(() => {
  fs.texts = { '/n/todo.md': 'first todo', '/w/todo.md': 'second todo', '/x/a.md': 'plain a' };
  fs.written = [];
  recents = Object.keys(fs.texts).map((path, i) => ({ path, opened_at: NOW - i }));
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve(recents);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    if (cmd === 'path_exists') return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

const tabs = () => screen.getAllByRole('tab');
const tab = (name: RegExp) => screen.getByRole('tab', { name });

/** Opens the recent whose row is named `path`'s file, from the Documents home. */
async function openRecent(user: User, path: string) {
  const rows = await screen.findAllByRole('button', { name: new RegExp(`^${path.split('/').pop()!.replace('.', '\\.')}`) });
  const row = rows.find((r) => r.getAttribute('title') === path || r.textContent?.includes(path)) ?? rows[0];
  await user.click(row);
  await screen.findByRole('tablist', { name: 'Open documents' });
}
async function back(user: User) {
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await screen.findByRole('heading', { name: 'Documents' });
}
async function openNew(user: User) {
  await user.click(screen.getByRole('button', { name: 'New' }));
  await screen.findByRole('tablist', { name: 'Open documents' });
}
function edit(extra: string) {
  settleEditors(document.body);
  select(0);
  typeText(extra);
}

it('"+" is File > New: each tap opens an untitled tab, and the new one is selected', async () => {
  const { user } = await renderMobileApp();
  await openNew(user);
  await user.click(screen.getByRole('button', { name: 'New tab' }));
  expect(tabs().map((t) => t.textContent)).toEqual(['Untitled.md', 'Untitled 2.md']);
  expect(tab(/Untitled 2/)).toHaveAttribute('aria-selected', 'true');
  expect(tab(/^Untitled\.md/)).toHaveAttribute('aria-selected', 'false');
  await user.click(tab(/^Untitled\.md/));
  expect(tab(/^Untitled\.md/)).toHaveAttribute('aria-selected', 'true');
});

it('the unsaved "●" follows the label of a dirty tab only; a clean active tab shows none', async () => {
  const { user } = await renderMobileApp();
  await openNew(user);
  expect(screen.queryByTitle('Unsaved changes')).toBeNull();
  await user.click(screen.getByRole('button', { name: 'New tab' }));
  await user.click(tab(/^Untitled\.md/));
  edit('x');
  await waitFor(() => expect(within(tab(/^Untitled\.md/)).getByTitle('Unsaved changes')).toHaveTextContent('●'));
  expect(within(tab(/^Untitled\.md/)).getByText('●')).toHaveAttribute('aria-label', 'unsaved changes');
  expect(tab(/^Untitled\.md/).textContent).toBe('Untitled.md●');
  expect(within(tab(/Untitled 2/)).queryByTitle('Unsaved changes')).toBeNull();
});

it('same-named local tabs get their folder, others keep their name', async () => {
  const { user } = await renderMobileApp();
  await openRecent(user, '/n/todo.md');
  await back(user);
  await openRecent(user, '/w/todo.md');
  await back(user);
  await openRecent(user, '/x/a.md');
  expect(tabs().map((t) => t.textContent)).toEqual(['n/todo.md', 'w/todo.md', 'a.md']);
});

it('every tab has a Close control, and Close, "+" and the tabs are 44px targets', async () => {
  const { user } = await renderMobileApp();
  await openNew(user);
  await user.click(screen.getByRole('button', { name: 'New tab' }));
  const strip = screen.getByRole('tablist', { name: 'Open documents' }).parentElement!;
  for (const control of [...tabs(), ...within(strip).getAllByRole('button')]) expect(control).toHaveClass('m-tap');
  expect(screen.getByRole('button', { name: 'Close Untitled.md' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Close Untitled 2.md' })).toBeInTheDocument();
});

it('closes a clean tab without asking; closing the last one goes back to Documents', async () => {
  const { user } = await renderMobileApp();
  await openNew(user);
  await user.click(screen.getByRole('button', { name: 'New tab' }));
  await user.click(screen.getByRole('button', { name: 'Close Untitled 2.md' }));
  expect(screen.queryByRole('dialog', { name: /Save changes/ })).toBeNull();
  expect(tabs()).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Close Untitled.md' }));
  expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
});

it('closing a dirty tab always asks; Cancel keeps it, Don’t save closes it', async () => {
  const { user } = await renderMobileApp();
  await openNew(user);
  edit('x');
  await waitFor(() => expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'Close Untitled.md' }));
  const dialog = await screen.findByRole('dialog', { name: 'Save changes to Untitled.md?' });
  expect(within(dialog).getByText('Your changes will be lost if you don’t save them.')).toBeInTheDocument();
  await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(tabs()).toHaveLength(1);
  await user.click(screen.getByRole('button', { name: 'Close Untitled.md' }));
  await user.click(await screen.findByRole('button', { name: 'Don’t save' }));
  expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
});

it('Save on the sheet writes the file, then closes the tab', async () => {
  const { user } = await renderMobileApp();
  await openRecent(user, '/x/a.md');
  settleEditors(document.body);
  caretAt('plain a', 7);
  typeText('!');
  await waitFor(() => expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument());
  await user.click(screen.getByRole('button', { name: 'Close a.md' }));
  await user.click(await screen.findByRole('button', { name: 'Save' }));
  await waitFor(() => expect(fs.written).toEqual([['/x/a.md', 'plain a!']]));
  expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
});

it('the Outline button is a top-bar button, not a registry command', async () => {
  const { user } = await renderMobileApp();
  await openNew(user);
  expect(screen.getByRole('button', { name: 'Document outline' })).toBeInTheDocument();
  expect(registry.commands().filter((c) => /outline/i.test(`${c.id} ${c.label}`))).toEqual([]);
});
