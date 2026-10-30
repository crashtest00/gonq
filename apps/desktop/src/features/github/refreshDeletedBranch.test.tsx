/** Navigator Refresh when the open GitHub branch was deleted: reported, switches to the default branch, warns before closing a dirty tab; a plain refresh never changes branch. */
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { settleEditors, type } from '@gonq/editor/testing/editor';
import { openGithub } from '@gonq/editor/platform/files';
import { menu, renderApp, type User } from '../../testing/renderApp';
import { githubPath } from '@gonq/editor/platform/github';

let deleted = false;
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (cmd === 'recent_documents_list') return [{ path: githubPath({ owner: 'octo', repo: 'notes', branch: 'dev', path: 'a.md' }), opened_at: 1 }];
  if (cmd === 'recent_documents_add' || cmd === 'recent_documents_remove') return [];
  if (cmd === 'take_launch_paths') return [];
  if (cmd === 'github_status') return { signed_in: true, login: 'me', storage: 'keychain' };
  if (cmd === 'github_list_branches') return { default_branch: 'main', branches: ['main', 'dev'], next_page: null };
  if (cmd === 'github_list_folder') {
    if (deleted && args!.branch === 'dev') throw { kind: 'branch_not_found', message: 'branch gone' };
    return { entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false };
  }
  if (cmd === 'github_read_file') return { path: args!.path, name: 'a.md', content: `# ${args!.branch}\n\nbody of ${args!.branch}`, sha: 's', commit_sha: 'c' };
  return undefined;
});
vi.mock('@gonq/editor/platform/bindings', async () => (await import('@gonq/editor/testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));
vi.mock('@gonq/editor/platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('@gonq/editor/platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  deleted = false;
  invoke.mockClear();
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

async function openDev(): Promise<User> {
  const { user } = renderApp({ files: { openPath: openGithub } });
  await user.click(screen.getByTitle('Folder navigator'));
  await user.click(await screen.findByRole('button', { name: /^a\.md.*@ dev/ }));
  await screen.findByText('body of dev');
  await settleEditors(document.body);
  await screen.findByRole('button', { name: 'Branch: dev' });
  return user;
}

it('a plain refresh keeps the branch and the tab and never asks', async () => {
  const user = await openDev();
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
  expect(screen.getAllByRole('tab')).toHaveLength(1);
});

it('a deleted branch with a clean tab: reported, then the default branch opens and the tab closes without a prompt', async () => {
  const user = await openDev();
  deleted = true;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryAllByRole('tab')).toHaveLength(0);
});

it('a deleted branch with unsaved changes: the message stays and Cancel keeps the branch and tab; Close document switches', async () => {
  const user = await openDev();
  type('X');
  expect(await screen.findByLabelText('unsaved changes')).toBeInTheDocument();
  deleted = true;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('dialog')).toHaveTextContent(/uncommitted changes will be permanently lost/);
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(screen.getByRole('alert')).toHaveTextContent('The branch “dev” no longer exists on GitHub');
  expect(screen.getAllByRole('tab')).toHaveLength(1);
  expect(screen.getByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());

  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await user.click(await screen.findByRole('button', { name: 'Close document' }));
  expect(await screen.findByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
  expect(screen.queryAllByRole('tab')).toHaveLength(0);
});

it('View > Refresh Navigator is enabled with a repository open and refreshes; the button has a tooltip and works from the keyboard', async () => {
  const user = await openDev();
  expect(screen.getByRole('button', { name: 'Refresh' })).toHaveAttribute('title', 'Refresh');
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  expect(await screen.findByRole('menuitem', { name: 'Refresh Navigator' })).not.toHaveAttribute('data-disabled');
  await user.keyboard('{Escape}');
  const before = invoke.mock.calls.filter((c) => c[0] === 'github_list_folder').length;
  await menu(user, 'View', 'Refresh Navigator');
  await waitFor(() => expect(invoke.mock.calls.filter((c) => c[0] === 'github_list_folder').length).toBeGreaterThan(before));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
  const mid = invoke.mock.calls.filter((c) => c[0] === 'github_list_folder').length;
  screen.getByRole('button', { name: 'Refresh' }).focus();
  await user.keyboard('{Enter}');
  await waitFor(() => expect(invoke.mock.calls.filter((c) => c[0] === 'github_list_folder').length).toBeGreaterThan(mid));
});
