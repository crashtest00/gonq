/** Navigator Refresh acceptance criteria through the real platform routing (only invoke is mocked): ssh:// listings and which GitHub folders are re-fetched. */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FolderSidebar } from './FolderSidebar';
import { RepoNavigator } from './RepoNavigator';

type Args = Record<string, unknown> | undefined;
const invoke = vi.fn<(cmd: string, args?: Args) => Promise<unknown>>();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: Args) => invoke(cmd, args) }));

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  cleanup();
  invoke.mockReset();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const noop = () => {};
const sidebar = (folder: string) => (
  <FolderSidebar folder={folder} recents={[]} currentPath={null} onOpenFolder={noop} onOpenFile={noop} onOpenRecent={noop} onRemoveRecent={noop} />
);
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);

it('re-lists an expanded ssh:// folder through remote_list_directory and keeps it open', async () => {
  const root = 'ssh://me@host/proj';
  let v = 1;
  invoke.mockImplementation(async (cmd, args) => {
    if (cmd !== 'remote_list_directory') throw new Error(`unexpected ${cmd}`);
    return args!.uri === root
      ? [{ name: 'docs', path: `${root}/docs`, is_dir: true }, { name: v === 1 ? 'a.md' : 'new.md', path: `${root}/x`, is_dir: false }]
      : [{ name: v === 1 ? 'b.md' : 'c.md', path: `${root}/docs/y`, is_dir: false }];
  });
  const user = userEvent.setup();
  render(sidebar(root));
  await user.click(await screen.findByRole('button', { name: /docs/ }));
  await screen.findByText('b.md');
  v = 2;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('new.md');
  await screen.findByText('c.md');
  expect(screen.queryByText('a.md')).toBeNull();
  expect(screen.getByRole('button', { name: /docs/ })).toHaveAttribute('aria-expanded', 'true');
  expect(calls('remote_list_directory').map((c) => c[1]!.uri).sort()).toEqual([root, root, `${root}/docs`, `${root}/docs`]);
  expect(calls('list_directory')).toHaveLength(0);
});

it('keeps the ssh:// tree and shows the error when the server is unreachable', async () => {
  const root = 'ssh://me@host/proj';
  invoke.mockResolvedValueOnce([{ name: 'a.md', path: `${root}/a.md`, is_dir: false }]);
  const user = userEvent.setup();
  render(sidebar(root));
  await screen.findByText('a.md');
  invoke.mockRejectedValueOnce({ kind: 'disconnected', message: 'x' });
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Lost connection to host.');
  expect(screen.getByText('a.md')).toBeInTheDocument();
});

it('re-lists an expanded GitHub subfolder with new content and does not fetch collapsed folders', async () => {
  let v = 1;
  const listed: string[] = [];
  invoke.mockImplementation(async (cmd, args) => {
    if (cmd === 'github_list_branches') return { default_branch: 'main', branches: ['main'], next_page: null };
    if (cmd !== 'github_list_folder') throw new Error(`unexpected ${cmd}`);
    const path = args!.path as string;
    listed.push(path);
    if (path === '') return { entries: [{ name: 'open', path: 'open', kind: 'folder' }, { name: 'shut', path: 'shut', kind: 'folder' }], truncated: false };
    if (path === 'open') return { entries: [{ name: v === 1 ? 'old.md' : 'fresh.md', path: `open/${v}.md`, kind: 'file' }], truncated: false };
    throw new Error(`collapsed folder ${path} fetched`);
  });
  const user = userEvent.setup();
  render(<RepoNavigator repo={{ owner: 'o', repo: 'r', branch: 'main' }} currentPath={null} onBranchChange={noop} onOpenFile={noop} />);
  await user.click(await screen.findByRole('button', { name: /open/ }));
  await screen.findByText('old.md');
  listed.length = 0;
  v = 2;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('fresh.md');
  expect(screen.queryByText('old.md')).toBeNull();
  expect(screen.getByRole('button', { name: /open/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: /shut/ })).toHaveAttribute('aria-expanded', 'false');
  expect([...listed].sort()).toEqual(['', 'open']);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
});
