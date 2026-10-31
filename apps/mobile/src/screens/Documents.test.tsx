/** Covers the mobile Documents home through renderMobileApp: recent rows (icon, name, owner/repo @ branch, time), the 10 cap, tap-to-reopen order (allowRecentDocument, then the read), remove, the empty text, Open Folder's not-available error, Open Repo through ensureSignedIn to the picker, and "+" = File > New. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
const calls: string[] = [];
vi.mock('@tauri-apps/plugin-fs', async (orig) => ({
  ...(await orig<object>()),
  readFile: vi.fn(async () => {
    calls.push('read');
    return new TextEncoder().encode('# Hi');
  }),
}));

import { renderMobileApp } from '../testing/renderMobileApp';

const NOW = Date.now();
type Row = { path: string; opened_at: number };
let store: Row[] = [];
let signedIn = false;
const seed = (rows: { path: string; openedAt: number }[]) => (store = rows.map((r) => ({ path: r.path, opened_at: r.openedAt })));

beforeEach(() => {
  store = [];
  signedIn = false;
  calls.length = 0;
  invoke.mockReset().mockImplementation((cmd: string, args?: { path?: string }) => {
    if (cmd === 'github_status') return Promise.resolve({ signed_in: signedIn, login: 'a', storage: 'keychain' });
    if (cmd === 'recent_documents_list') return Promise.resolve(store);
    if (cmd === 'recent_documents_remove') return Promise.resolve((store = store.filter((r) => r.path !== args?.path)));
    if (cmd === 'allow_recent_document') calls.push('allow');
    if (cmd === 'path_exists') return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

it('shows the empty text and always shows Open Repo…, Open Folder… and New', async () => {
  await renderMobileApp();
  expect(screen.getByText('No recent documents.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Repo…' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Open Folder…' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New' })).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/server/i);
});

it('lists local and GitHub recents with desktop row content and an accessible remove control', async () => {
  seed([
    { path: '/docs/a.md', openedAt: NOW - 5 * 60_000 },
    { path: 'github://northwind/platform-docs@main/docs/arch.md', openedAt: NOW - 3 * 3_600_000 },
    { path: '/docs/b.md', openedAt: NOW - 2 * 86_400_000 },
  ]);
  await renderMobileApp();
  const items = await screen.findAllByRole('listitem');
  expect(items).toHaveLength(3);
  expect(within(items[0]).getByText('a.md')).toBeInTheDocument();
  expect(within(items[0]).getByText('5 min ago')).toBeInTheDocument();
  expect(within(items[1]).getByText('arch.md')).toBeInTheDocument();
  expect(within(items[1]).getByText('northwind/platform-docs @ main')).toBeInTheDocument();
  expect(within(items[1]).getByText('3 h ago')).toBeInTheDocument();
  expect(within(items[2]).getByText('2 d ago')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove arch.md from recent documents' })).toBeInTheDocument();
});

it('shows at most 10 recents', async () => {
  seed(Array.from({ length: 14 }, (_, i) => ({ path: `/d/f${i}.md`, openedAt: NOW - i * 1000 })));
  await renderMobileApp();
  expect(await screen.findAllByRole('listitem')).toHaveLength(10);
});

it('removes a recent through removeRecent', async () => {
  seed([
    { path: '/d/a.md', openedAt: NOW },
    { path: '/d/b.md', openedAt: NOW - 1000 },
  ]);
  const { user } = await renderMobileApp();
  await user.click(await screen.findByRole('button', { name: 'Remove a.md from recent documents' }));
  await waitFor(() => expect(screen.getAllByRole('listitem')).toHaveLength(1));
  expect(invoke).toHaveBeenCalledWith('recent_documents_remove', { path: '/d/a.md' });
});

it('reopens a local recent: allowRecentDocument first, then the read', async () => {
  seed([{ path: '/d/a.md', openedAt: NOW }]);
  const { user } = await renderMobileApp();
  await user.click(await screen.findByRole('button', { name: /^a\.md/ }));
  await waitFor(() => expect(calls).toEqual(['allow', 'read']));
});

it('Open Folder… shows a not-available error in the banner', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Folder…' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not available yet');
});

it('Open Repo… goes through ensureSignedIn: signed out opens the sign-in screen', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
});

it('Open Repo… when signed in does not ask to sign in and opens the picker', async () => {
  signedIn = true;
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  expect(await screen.findByRole('heading', { name: 'Open repository' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Start' })).toBeNull();
});

it('+ runs File > New without error', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'New' }));
  expect(screen.queryByRole('alert')).toBeNull();
});
