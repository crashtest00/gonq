/** The GitHub repo navigator: header, branch dropdown (order, filter, paging), lazy tree, branch switch, messages. */
import { useState } from 'react';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GitHubError } from '../platform/github';
import { FolderSidebar } from './FolderSidebar';
import { BRANCH_RENDER_CAP, RepoNavigator, type RepoState } from './RepoNavigator';

const listBranches = vi.fn();
const listFolder = vi.fn();
const ensureSignedIn = vi.fn(async () => true);
vi.mock('../platform/github', async (orig) => ({
  ...(await orig<typeof import('../platform/github')>()),
  listBranches: (...a: unknown[]) => listBranches(...a),
  listFolder: (...a: unknown[]) => listFolder(...a),
  ensureSignedIn: () => ensureSignedIn(),
}));
// The platform boundary is exercised for real: folders.ts routes github:// paths to the mocked github.ts.
vi.mock('../platform/files', () => ({ isTauri: () => true }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn() }));

const dir = (path: string) => ({ name: path.split('/').pop()!, path, kind: 'folder' as const });
const md = (path: string) => ({ name: path.split('/').pop()!, path, kind: 'file' as const });

/** A fake repository: tree[branch][folder path] = entries. */
let tree: Record<string, Record<string, ReturnType<typeof dir | typeof md>[]>>;
let branchPages: { defaultBranch: string; branches: string[]; nextPage: number | null }[];

beforeEach(() => {
  tree = {
    main: { '': [dir('docs'), dir('old'), md('README.md')], docs: [dir('docs/deep'), md('docs/a.md')], 'docs/deep': [md('docs/deep/z.md')], old: [md('old/x.md')] },
    other: { '': [dir('docs'), md('NOTES.md')], docs: [md('docs/b.md')] },
  };
  branchPages = [{ defaultBranch: 'main', branches: ['main', 'other'], nextPage: null }];
  listBranches.mockImplementation(async (_o: string, _r: string, page: number) => branchPages[page - 1]);
  listFolder.mockImplementation(async (_o: string, _r: string, branch: string, path: string) => {
    const t = tree[branch];
    if (t === undefined) throw new GitHubError('branch_not_found', 'gone');
    if (t[path] === undefined) throw new GitHubError('path_not_found', 'nope');
    return { entries: t[path], truncated: false };
  });
});
afterEach(() => {
  cleanup();
  listBranches.mockReset();
  listFolder.mockReset();
  ensureSignedIn.mockClear();
});

function Harness({ onOpenFile = () => {}, start = 'main' }: { onOpenFile?: (p: string) => void; start?: string }) {
  const [repo, setRepo] = useState<RepoState>({ owner: 'octo', repo: 'notes', branch: start });
  return <RepoNavigator repo={repo} currentPath={null} onBranchChange={(branch) => setRepo({ ...repo, branch })} onOpenFile={onOpenFile} />;
}

const openMenu = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('button', { name: /^Branch:/ }));
  return screen.getByRole('listbox', { name: 'Branches' });
};
const optionNames = () => within(screen.getByRole('listbox', { name: 'Branches' })).getAllByRole('option').map((o) => o.textContent);

it('shows owner/repo and the branch in the header, with an empty slot for a future action', async () => {
  const { container } = render(<Harness />);
  expect(screen.getByText('octo/notes')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
  expect(container.querySelector('[data-slot="branch-actions"]')?.childElementCount).toBe(0);
  await screen.findByText('README.md');
});

it('lists the root first and folders lazily on expansion, opening a file with its github:// path', async () => {
  const onOpenFile = vi.fn();
  const user = userEvent.setup();
  render(<Harness onOpenFile={onOpenFile} />);
  await screen.findByText('README.md');
  expect(listFolder).toHaveBeenCalledTimes(1);
  expect(listFolder).toHaveBeenCalledWith('octo', 'notes', 'main', '');
  await user.click(screen.getByRole('button', { name: /docs/ }));
  await user.click(await screen.findByText('a.md'));
  expect(listFolder).toHaveBeenCalledWith('octo', 'notes', 'main', 'docs');
  expect(listFolder).toHaveBeenCalledTimes(2);
  expect(onOpenFile).toHaveBeenCalledWith('github://octo/notes@main/docs/a.md');
  // collapse and re-expand does not list again
  await user.click(screen.getByRole('button', { name: /docs/ }));
  await user.click(screen.getByRole('button', { name: /docs/ }));
  expect(listFolder).toHaveBeenCalledTimes(2);
});

it('puts the default branch first and loads every page sequentially, with a loading-more indicator', async () => {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  branchPages = [
    { defaultBranch: 'trunk', branches: ['trunk', 'a'], nextPage: 2 },
    { defaultBranch: 'trunk', branches: ['b', 'c'], nextPage: null },
  ];
  listBranches.mockImplementation(async (_o: string, _r: string, page: number) => {
    if (page === 2) await gate;
    return branchPages[page - 1];
  });
  tree.trunk = tree.main;
  const user = userEvent.setup();
  render(<Harness start="trunk" />);
  await screen.findByText('README.md');
  await openMenu(user);
  await waitFor(() => expect(optionNames()).toEqual(['trunk', 'a']));
  await waitFor(() => expect(listBranches.mock.calls.map((c) => c[2])).toEqual([1, 2]));
  expect(await screen.findByRole('status')).toHaveTextContent('Loading more…');
  release();
  await waitFor(() => expect(optionNames()).toEqual(['trunk', 'a', 'b', 'c']));
  expect(screen.queryByText('Loading more…')).not.toBeInTheDocument();
  expect(listBranches.mock.calls.map((c) => c[2])).toEqual([1, 2]);
});

it('filters branches case-insensitively, including slashes and unicode', async () => {
  branchPages = [{ defaultBranch: 'main', branches: ['main', 'Feature/Ünï', 'feature/two', 'release-1', '日本語/ブランチ'], nextPage: null }];
  const user = userEvent.setup();
  render(<Harness />);
  await openMenu(user);
  await waitFor(() => expect(optionNames()).toHaveLength(5));
  const box = screen.getByRole('textbox', { name: 'Filter branches' });
  await user.type(box, 'FEATURE/');
  expect(optionNames()).toEqual(['Feature/Ünï', 'feature/two']);
  await user.clear(box);
  await user.type(box, 'ünï');
  expect(optionNames()).toEqual(['Feature/Ünï']);
  await user.clear(box);
  await user.type(box, '日本');
  expect(optionNames()).toEqual(['日本語/ブランチ']);
  await user.clear(box);
  await user.type(box, 'zzz');
  expect(screen.getByText('No branch matches.')).toBeInTheDocument();
});

it('caps what a very long branch list renders and says how to narrow it', async () => {
  const many = Array.from({ length: 2500 }, (_, i) => `branch-${i}`);
  branchPages = [{ defaultBranch: 'main', branches: ['main', ...many], nextPage: null }];
  const user = userEvent.setup();
  render(<Harness />);
  await openMenu(user);
  await waitFor(() => expect(screen.getByText(/Type to narrow the list/)).toBeInTheDocument());
  expect(optionNames()).toHaveLength(BRANCH_RENDER_CAP);
  expect(screen.getByText(`Showing the first ${BRANCH_RENDER_CAP} of 2501 branches. Type to narrow the list.`)).toBeInTheDocument();
  await user.type(screen.getByRole('textbox', { name: 'Filter branches' }), 'branch-2499');
  expect(optionNames()).toEqual(['branch-2499']);
});

it('switching branch reloads the root and keeps only expanded folders that exist on the new branch', async () => {
  const user = userEvent.setup();
  render(<Harness />);
  await screen.findByText('README.md');
  await user.click(screen.getByRole('button', { name: /docs/ }));
  await user.click(await screen.findByRole('button', { name: /deep/ }));
  await screen.findByText('z.md');
  await user.click(screen.getByRole('button', { name: /old/ }));
  await screen.findByText('x.md');

  await openMenu(user);
  await user.click(await screen.findByRole('option', { name: 'other' }));

  await screen.findByText('NOTES.md');
  expect(screen.getByRole('button', { name: 'Branch: other' })).toBeInTheDocument();
  // docs exists on "other" and stays open; old and docs/deep do not exist there
  expect(await screen.findByText('b.md')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: /docs/ })).toHaveAttribute('aria-expanded', 'true');
  expect(screen.queryByText('x.md')).not.toBeInTheDocument();
  expect(listFolder).toHaveBeenCalledWith('octo', 'notes', 'other', '');
  expect(listFolder).toHaveBeenCalledWith('octo', 'notes', 'other', 'docs');
  expect(listFolder).not.toHaveBeenCalledWith('octo', 'notes', 'other', 'old');
  // going back: only docs was kept, so deep is collapsed again
  await openMenu(user);
  await user.click(await screen.findByRole('option', { name: 'main' }));
  await screen.findByText('README.md');
  await screen.findByText('a.md');
  expect(screen.getByRole('button', { name: /deep/ })).toHaveAttribute('aria-expanded', 'false');
  expect(screen.queryByText('z.md')).not.toBeInTheDocument();
});

describe_messages();

function describe_messages() {
  const fail = (kind: ConstructorParameters<typeof GitHubError>[0], resetAt: number | null = null) =>
    listFolder.mockRejectedValue(new GitHubError(kind, 'msg', resetAt));

  it('says so for an empty repository', async () => {
    fail('empty_repo');
    render(<Harness />);
    expect(await screen.findByRole('alert')).toHaveTextContent('This repository is empty');
  });

  it('says so for a branch that no longer exists', async () => {
    fail('branch_not_found');
    render(<Harness />);
    expect(await screen.findByRole('alert')).toHaveTextContent('The branch “main” no longer exists on GitHub');
    expect(screen.getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
  });

  it('says so for a root with no Markdown files', async () => {
    tree.main[''] = [];
    render(<Harness />);
    expect(await screen.findByText('No Markdown files in this branch.')).toBeInTheDocument();
  });

  it('says so for a folder with no Markdown files', async () => {
    tree.main.docs = [];
    const user = userEvent.setup();
    render(<Harness />);
    await user.click(await screen.findByRole('button', { name: /docs/ }));
    expect(await screen.findByText('No Markdown files in this folder.')).toBeInTheDocument();
  });

  it('notes a truncated listing', async () => {
    listFolder.mockResolvedValue({ entries: [md('a.md')], truncated: true });
    render(<Harness />);
    expect(await screen.findByText('Showing what GitHub returned; the folder may have more.')).toBeInTheDocument();
    expect(screen.getByText('a.md')).toBeInTheDocument();
  });

  it('shows the rate-limit reset time and retries', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    fail('rate_limited', reset);
    const user = userEvent.setup();
    render(<Harness />);
    const alert = await screen.findByRole('alert');
    const time = new Date(reset * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    expect(alert).toHaveTextContent(`GitHub rate limit reached. Try again after ${time}.`);
    listFolder.mockReset();
    listFolder.mockResolvedValue({ entries: [md('ok.md')], truncated: false });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('ok.md')).toBeInTheDocument();
  });

  it('offers sign in when not signed in, then reloads', async () => {
    fail('not_signed_in');
    const user = userEvent.setup();
    render(<Harness />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sign in to GitHub to browse this repository.');
    listFolder.mockReset();
    listFolder.mockResolvedValue({ entries: [md('in.md')], truncated: false });
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(ensureSignedIn).toHaveBeenCalled();
    expect(await screen.findByText('in.md')).toBeInTheDocument();
  });

  it('shows other errors with Retry', async () => {
    fail('other');
    const user = userEvent.setup();
    render(<Harness />);
    expect(await screen.findByRole('alert')).toHaveTextContent('msg');
    listFolder.mockReset();
    listFolder.mockResolvedValue({ entries: [md('back.md')], truncated: false });
    await user.click(screen.getByRole('button', { name: 'Retry' }));
    expect(await screen.findByText('back.md')).toBeInTheDocument();
  });

  it('shows a branch-list failure inside the dropdown with Retry', async () => {
    listBranches.mockRejectedValueOnce(new GitHubError('network', 'offline'));
    const user = userEvent.setup();
    render(<Harness />);
    await openMenu(user);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Could not reach GitHub while loading branches');
    await user.click(within(alert).getByRole('button', { name: 'Retry' }));
    await waitFor(() => expect(optionNames()).toEqual(['main', 'other']));
  });
}

it('FolderSidebar shows the repo navigator instead of the folder when a repo is open', async () => {
  render(
    <FolderSidebar
      folder="/local"
      repo={{ owner: 'octo', repo: 'notes', branch: 'main' }}
      recents={[]}
      currentPath={null}
      onOpenFolder={() => {}}
      onOpenFile={() => {}}
      onOpenRecent={() => {}}
      onRemoveRecent={() => {}}
    />,
  );
  expect(screen.getByText('octo/notes')).toBeInTheDocument();
  await screen.findByText('README.md');
  expect(screen.queryByText('local')).not.toBeInTheDocument();
});
