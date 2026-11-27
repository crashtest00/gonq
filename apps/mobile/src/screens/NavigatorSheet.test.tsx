/** Covers the one mobile navigator sheet (M-43) through renderMobileApp: the top-bar button opens the repo tree while a repository is open and the local folder otherwise (repo wins when both were opened), the picker returns to its own screen and opens the sheet on the repository with no repo screen left, the repo tree stays mounted when the sheet closes, and View > Refresh Navigator (enabled with a folder or a repo, works with the sheet closed, one refresh at a time) refreshes both sources. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
import { fakeSafPlugin } from '@gonq/editor/testing/mockBindings';

const saf = fakeSafPlugin();
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => (cmd.startsWith('plugin:gonq-saf|') ? saf.invoke(cmd, args) : Promise.resolve(undefined)) }));
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { renderMobileApp, type User } from '../testing/renderMobileApp';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2Fnotes';
let recents: { path: string; opened_at: number }[] = [];
let handlers: Record<string, (a: Record<string, unknown>) => unknown>;
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);

beforeEach(() => {
  recents = [];
  saf.calls.length = 0;
  saf.granted.clear();
  saf.nextPick = null;
  saf.addTree(TREE, { 'local.md': '# l' });
  handlers = {
    recent_documents_list: () => recents,
    recent_documents_add: (a) => (recents = [{ path: a.path as string, opened_at: Date.now() }, ...recents]),
    github_status: () => ({ signed_in: true, login: 'octo', storage: 'keychain' }),
    github_list_repos: () => ({
      repos: [{ owner: 'o', name: 'r', full_name: 'o/r', private: false, default_branch: 'main', can_push: true, pushed_at: null }],
      next_page: null,
    }),
    github_list_branches: () => ({ default_branch: 'main', branches: ['main'], next_page: null }),
    github_list_folder: () => ({ entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false }),
  };
  invoke.mockReset().mockImplementation(async (cmd: string, args?: Record<string, unknown>) => handlers[cmd]?.(args ?? {}));
});

async function openRepo(user: User) {
  await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await user.click(await screen.findByRole('button', { name: /o\/r/ }));
  return screen.findByRole('dialog', { name: 'o/r' });
}
const closeSheet = (user: User, name: string) => user.click(within(screen.getByRole('dialog', { name })).getByRole('button', { name: 'Close' }));
const refreshItem = async (user: User) => {
  await user.click(screen.getByRole('button', { name: 'More' }));
  return screen.findByRole('menuitem', { name: 'Refresh Navigator' });
};

it('with nothing open the button opens today\'s "No folder open" sheet and Refresh Navigator is disabled', async () => {
  const { user } = await renderMobileApp();
  expect(await refreshItem(user)).toBeDisabled();
  await user.keyboard('{Escape}');
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  expect(within(screen.getByRole('dialog', { name: 'Folder navigator' })).getByText('No folder open')).toBeInTheDocument();
});

it('a local folder with no repository: the button opens the folder sheet', async () => {
  saf.nextPick = { tree: TREE, name: 'notes' };
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Folder…' }));
  const s = await screen.findByRole('dialog', { name: 'Folder navigator' });
  expect(await within(s).findByRole('button', { name: 'local.md' })).toBeInTheDocument();
});

it('choosing a repository returns to the screen the picker came from and opens the sheet on it, with no repo screen left', async () => {
  const { user } = await renderMobileApp();
  const s = await openRepo(user);
  expect(await within(s).findByRole('button', { name: 'a.md' })).toBeInTheDocument();
  expect(screen.getByRole('img', { name: 'Gonq' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Open repository' })).toBeNull();
  expect(within(s).getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
  expect(within(s).getByRole('button', { name: 'Create branch' })).toBeInTheDocument();
  await closeSheet(user, 'o/r');
  expect(screen.getByRole('img', { name: 'Gonq' })).toBeInTheDocument();
  // The same button now opens the repository.
  await user.click(screen.getByRole('button', { name: 'Repository navigator' }));
  expect(screen.getByRole('dialog', { name: 'o/r' })).toBeInTheDocument();
});

it('with a folder and a repository both opened, the repository shows', async () => {
  saf.nextPick = { tree: TREE, name: 'notes' };
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Folder…' }));
  await screen.findByRole('dialog', { name: 'Folder navigator' });
  await closeSheet(user, 'Folder navigator');
  await openRepo(user);
  expect(screen.queryByRole('dialog', { name: 'Folder navigator' })).toBeNull();
});

it('opening a file from the repo sheet closes it and shows the editor; the tree keeps its nodes while closed', async () => {
  handlers.github_read_file = (a) => ({ path: a.path, name: 'a.md', content: '# A', sha: 's', commit_sha: 'c' });
  const { user } = await renderMobileApp();
  const s = await openRepo(user);
  const row = await within(s).findByRole('button', { name: 'a.md' });
  await user.click(row);
  expect(await screen.findByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'o/r' })).toBeNull();
  expect(row.isConnected).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Repository navigator' }));
  expect(await screen.findByRole('button', { name: 'a.md' })).toBe(row);
});

it('View > Refresh Navigator re-lists the repository tree while the sheet is closed', async () => {
  const { user } = await renderMobileApp();
  await openRepo(user);
  await screen.findByRole('button', { name: 'a.md' });
  await closeSheet(user, 'o/r');
  const before = calls('github_list_folder').length;
  const item = await refreshItem(user);
  expect(item).toBeEnabled();
  await user.click(item);
  await waitFor(() => expect(calls('github_list_folder').length).toBe(before + 1));
});

it('View > Refresh Navigator re-lists the local folder while the sheet is closed', async () => {
  saf.nextPick = { tree: TREE, name: 'notes' };
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Folder…' }));
  const s = await screen.findByRole('dialog', { name: 'Folder navigator' });
  await within(s).findByRole('button', { name: 'local.md' });
  await closeSheet(user, 'Folder navigator');
  saf.addTree(TREE, { 'local.md': '# l', 'added.md': '# a' });
  await user.click(await refreshItem(user));
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  expect(await screen.findByRole('button', { name: 'added.md' })).toBeInTheDocument();
});
