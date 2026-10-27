/** The navigator's Refresh button: local/ssh folder tree and GitHub repo tree re-list in place, keeping expanded folders. */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { FolderSidebar } from './FolderSidebar';
import { RepoNavigator } from './RepoNavigator';

const listDirectory = vi.fn();
vi.mock('../platform/folders', async (orig) => ({
  ...(await orig<typeof import('../platform/folders')>()),
  listDirectory: (p: string) => listDirectory(p),
}));
const listFolder = vi.fn();
const listBranches = vi.fn();
vi.mock('../platform/github', async (orig) => ({
  ...(await orig<typeof import('../platform/github')>()),
  listFolder: (...a: unknown[]) => listFolder(...a),
  listBranches: (...a: unknown[]) => listBranches(...a),
}));

afterEach(() => {
  cleanup();
  listDirectory.mockReset();
  listFolder.mockReset();
  listBranches.mockReset();
});

const noop = () => {};

it('refreshes a folder tree, including expanded subfolders', async () => {
  let v = 1;
  listDirectory.mockImplementation(async (p: string) =>
    p === '/proj'
      ? [{ name: 'docs', path: '/proj/docs', isDir: true }, { name: v === 1 ? 'a.md' : 'new.md', path: '/proj/x', isDir: false }]
      : [{ name: v === 1 ? 'b.md' : 'c.md', path: '/proj/docs/b', isDir: false }],
  );
  const user = userEvent.setup();
  render(<FolderSidebar folder="/proj" recents={[]} currentPath={null} onOpenFolder={noop} onOpenFile={noop} onOpenRecent={noop} onRemoveRecent={noop} />);
  await user.click(await screen.findByRole('button', { name: /docs/ }));
  await screen.findByText('b.md');
  v = 2;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('new.md');
  await screen.findByText('c.md');
  expect(screen.queryByText('a.md')).toBeNull();
  expect(screen.getByRole('button', { name: /docs/ })).toHaveAttribute('aria-expanded', 'true');
});

it('refreshes a GitHub repo tree and its branch list', async () => {
  let v = 1;
  listBranches.mockImplementation(async () => ({ defaultBranch: 'main', branches: v === 1 ? ['main'] : ['main', 'fresh'], nextPage: null }));
  listFolder.mockImplementation(async (_o: string, _r: string, _b: string, path: string) => ({
    entries: path === '' ? [{ name: v === 1 ? 'a.md' : 'b.md', path: v === 1 ? 'a.md' : 'b.md', kind: 'file' }] : [],
    truncated: false,
  }));
  const user = userEvent.setup();
  render(<RepoNavigator repo={{ owner: 'o', repo: 'r', branch: 'main' }} currentPath={null} onBranchChange={noop} onOpenFile={noop} />);
  await screen.findByText('a.md');
  v = 2;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('b.md');
  expect(screen.queryByText('a.md')).toBeNull();
  await user.click(screen.getByRole('button', { name: /^Branch:/ }));
  await waitFor(() => expect(screen.getByRole('option', { name: 'fresh' })).toBeInTheDocument());
});
