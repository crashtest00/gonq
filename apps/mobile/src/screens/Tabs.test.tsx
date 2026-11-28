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
import { openMenu } from '../testing/menu';
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
  // With a tab open the home is gone: the other documents open from File > Open Recent.
  // The list is the recents in order: n/todo.md (open), w/todo.md, a.md.
  for (const [i, row] of [1, 2].entries()) {
    await openMenu(user, 'File', 'Open Recent');
    await user.click(screen.getAllByRole('menuitem')[row]);
    await waitFor(() => expect(tabs().length).toBeGreaterThan(i + 1));
  }
  expect(tabs().map((t) => t.textContent)).toEqual(['n/todo.md', 'w/todo.md', 'a.md']);
});
