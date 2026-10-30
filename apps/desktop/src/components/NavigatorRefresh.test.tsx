/** The navigator's Refresh button: local/ssh folder tree and GitHub repo tree re-list in place, keeping expanded folders. */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, expect, it, vi } from 'vitest';
import { FolderSidebar } from './FolderSidebar';
import { RepoNavigator } from './RepoNavigator';

const listDirectory = vi.fn();
vi.mock('@gonq/editor/platform/folders', async (orig) => ({
  ...(await orig<typeof import('@gonq/editor/platform/folders')>()),
  listDirectory: (p: string) => listDirectory(p),
}));
const listFolder = vi.fn();
const listBranches = vi.fn();
vi.mock('@gonq/editor/platform/github', async (orig) => ({
  ...(await orig<typeof import('@gonq/editor/platform/github')>()),
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

it('disables the button while refreshing and ignores a second start', async () => {
  let release: (v: unknown) => void = () => {};
  listDirectory.mockResolvedValueOnce([{ name: 'a.md', path: '/proj/a', isDir: false }]);
  const user = userEvent.setup();
  render(<FolderSidebar folder="/proj" recents={[]} currentPath={null} onOpenFolder={noop} onOpenFile={noop} onOpenRecent={noop} onRemoveRecent={noop} />);
  await screen.findByText('a.md');
  listDirectory.mockImplementationOnce(() => new Promise((r) => (release = r)));
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  const btn = screen.getByRole('button', { name: 'Refresh' });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute('aria-busy', 'true');
  await user.click(btn);
  expect(listDirectory).toHaveBeenCalledTimes(2);
  release([{ name: 'b.md', path: '/proj/b', isDir: false }]);
  await screen.findByText('b.md');
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
});

it('keeps the tree and shows the error when a local refresh fails', async () => {
  listDirectory.mockResolvedValueOnce([{ name: 'a.md', path: '/proj/a', isDir: false }]);
  const user = userEvent.setup();
  render(<FolderSidebar folder="/proj" recents={[]} currentPath={null} onOpenFolder={noop} onOpenFile={noop} onOpenRecent={noop} onRemoveRecent={noop} />);
  await screen.findByText('a.md');
  listDirectory.mockRejectedValueOnce(new Error('disk gone'));
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('disk gone');
  expect(screen.getByText('a.md')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
});

it('refreshSignal refreshes like the button', async () => {
  listDirectory.mockResolvedValueOnce([{ name: 'a.md', path: '/proj/a', isDir: false }]);
  const props = { folder: '/proj', recents: [], currentPath: null, onOpenFolder: noop, onOpenFile: noop, onOpenRecent: noop, onRemoveRecent: noop };
  const { rerender } = render(<FolderSidebar {...props} refreshSignal={0} />);
  await screen.findByText('a.md');
  listDirectory.mockResolvedValueOnce([{ name: 'z.md', path: '/proj/z', isDir: false }]);
  rerender(<FolderSidebar {...props} refreshSignal={1} />);
  await screen.findByText('z.md');
});

it('a deleted branch on refresh switches to the default branch', async () => {
  const { GitHubError } = await import('@gonq/editor/platform/github');
  const onBranchChange = vi.fn();
  listBranches.mockResolvedValue({ defaultBranch: 'main', branches: ['main', 'old'], nextPage: null });
  listFolder.mockResolvedValueOnce({ entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false });
  const user = userEvent.setup();
  render(<RepoNavigator repo={{ owner: 'o', repo: 'r', branch: 'old' }} currentPath={null} onBranchChange={onBranchChange} onOpenFile={noop} />);
  await screen.findByText('a.md');
  listFolder.mockRejectedValueOnce(new GitHubError('branch_not_found', 'gone'));
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(onBranchChange).toHaveBeenCalledWith('main'));
});

it('a failed GitHub refresh keeps the rows and expanded folders and reports the error', async () => {
  listBranches.mockResolvedValue({ defaultBranch: 'main', branches: ['main'], nextPage: null });
  listFolder.mockImplementation(async (_o: string, _r: string, _b: string, path: string) => ({
    entries: path === '' ? [{ name: 'docs', path: 'docs', kind: 'folder' }] : [{ name: 'in.md', path: 'docs/in.md', kind: 'file' }],
    truncated: false,
  }));
  const user = userEvent.setup();
  render(<RepoNavigator repo={{ owner: 'o', repo: 'r', branch: 'main' }} currentPath={null} onBranchChange={noop} onOpenFile={noop} />);
  await user.click(await screen.findByRole('button', { name: /docs/ }));
  await screen.findByText('in.md');
  listFolder.mockRejectedValue(Object.assign(new Error('offline'), { kind: 'network' }));
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByRole('alert');
  expect(screen.getByText('in.md')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /docs/ })).toHaveAttribute('aria-expanded', 'true');
});

it('shows a disabled Refresh control when no folder or repository is open', () => {
  render(<FolderSidebar folder={null} recents={[]} currentPath={null} onOpenFolder={noop} onOpenFile={noop} onOpenRecent={noop} onRemoveRecent={noop} />);
  const btn = screen.getByRole('button', { name: 'Refresh' });
  expect(btn).toBeDisabled();
  expect(btn).toHaveAttribute('title', 'Refresh');
});

it('refreshes an ssh:// folder tree and shows the spinning icon while busy', async () => {
  const root = 'ssh://me@host/proj';
  listDirectory.mockResolvedValueOnce([{ name: 'a.md', path: `${root}/a.md`, isDir: false }]);
  const user = userEvent.setup();
  const { container } = render(<FolderSidebar folder={root} recents={[]} currentPath={null} onOpenFolder={noop} onOpenFile={noop} onOpenRecent={noop} onRemoveRecent={noop} />);
  await screen.findByText('a.md');
  let release: (v: unknown) => void = () => {};
  listDirectory.mockImplementationOnce(() => new Promise((r) => (release = r)));
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  expect(container.querySelector('svg.animate-spin')).not.toBeNull();
  release([{ name: 'b.md', path: `${root}/b.md`, isDir: false }]);
  await screen.findByText('b.md');
  expect(listDirectory).toHaveBeenLastCalledWith(root);
  await waitFor(() => expect(container.querySelector('svg.animate-spin')).toBeNull());
});
