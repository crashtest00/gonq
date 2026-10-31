/** Covers the mobile repo navigator screen through renderMobileApp, porting NavigatorRefreshTree.test.tsx and the GitHub parts of RepoNavigator.test.tsx: Refresh (always rendered, busy, same DOM nodes, kept rows and Retry on failure, branch list refetched, default-branch fallback when the branch was deleted), the branch sheet (filter, check mark, cap, loading, empty, error), the empty/"Show more"/truncated tree texts, describeError wording, and a tapped file opening as a github:// document. */
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { renderMobileApp, type User } from '../testing/renderMobileApp';

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);
const file = (path: string) => ({ name: path.split('/').pop()!, path, kind: 'file' });
const folder = (path: string) => ({ name: path.split('/').pop()!, path, kind: 'folder' });
const listed = (entries: unknown[], truncated = false) => ({ entries, truncated });

beforeEach(() => {
  invoke.mockReset();
  handlers = {
    github_status: () => ({ signed_in: true, login: 'octo', storage: 'keychain' }),
    github_list_repos: () => ({
      repos: [{ owner: 'o', name: 'r', full_name: 'o/r', private: false, default_branch: 'main', can_push: true, pushed_at: null }],
      next_page: null,
    }),
    github_list_branches: () => ({ default_branch: 'main', branches: ['main', 'dev'], next_page: null }),
    github_list_folder: () => listed([file('a.md')]),
    recent_documents_list: () => [],
  };
  invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => handlers[cmd]?.(args ?? {}));
});

async function openRepoTree(): Promise<{ user: User }> {
  const r = await renderMobileApp();
  await r.user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await r.user.click(await screen.findByRole('button', { name: /o\/r/ }));
  await screen.findByRole('heading', { name: 'o/r' });
  return r;
}

const refreshBtn = () => screen.getByRole('button', { name: 'Refresh' });
const settled = () => waitFor(() => expect(refreshBtn()).toBeEnabled());
const deferred = () => {
  let resolve!: (v: unknown) => void;
  const p = new Promise((res) => (resolve = res));
  return { p, resolve };
};

it('the repo name is the title, the tree comes from github_list_folder and there is no Switch branch button', async () => {
  await openRepoTree();
  expect(await screen.findByRole('button', { name: 'a.md' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /switch branch/i })).toBeNull();
  expect(calls('github_list_folder')[0][1]).toEqual({ owner: 'o', repo: 'r', branch: 'main', path: '' });
});

it('Refresh shows renamed, deleted and added files and keeps expanded folder, highlight and untouched rows as the same DOM nodes', async () => {
  let v = 1;
  const fillers = Array.from({ length: 10 }, (_, i) => file(`f${i}.md`));
  handlers.github_list_folder = (a) => {
    if (a.path === 'docs') return listed([file(v === 1 ? 'docs/inner-old.md' : 'docs/inner-new.md')]);
    return listed([folder('docs'), ...fillers, file(v === 1 ? 'old.md' : 'new.md')]);
  };
  handlers.github_read_file = () => ({ path: 'f5.md', name: 'f5.md', content: '# F', sha: 's', commit_sha: 'c' });
  const { user } = await openRepoTree();
  await user.click(await screen.findByRole('button', { name: /docs/ }));
  await screen.findByText('inner-old.md');
  const docs = screen.getByRole('button', { name: /docs/ });
  const far = screen.getByRole('button', { name: /f9\.md/ });
  const group = screen.getByRole('group', { name: 'Files' });

  v = 2;
  await user.click(refreshBtn());
  await screen.findByText('new.md');
  await screen.findByText('inner-new.md');
  expect(screen.queryByText('old.md')).toBeNull();
  expect(screen.queryByText('inner-old.md')).toBeNull();
  expect(screen.getByRole('button', { name: /docs/ })).toBe(docs);
  expect(docs).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: /f9\.md/ })).toBe(far);
  expect(screen.getByRole('group', { name: 'Files' })).toBe(group);
});

it('Refresh is always rendered, shows its busy state and is disabled while listing', async () => {
  const slow = deferred();
  const { user } = await openRepoTree();
  await screen.findByText('a.md');
  expect(refreshBtn()).toBeEnabled();
  handlers.github_list_folder = () => slow.p;
  await user.click(refreshBtn());
  expect(refreshBtn()).toBeDisabled();
  expect(refreshBtn()).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByText('a.md')).toBeInTheDocument();
  await act(async () => slow.resolve(listed([file('b.md')])));
  await screen.findByText('b.md');
  await settled();
  expect(refreshBtn()).toHaveAttribute('aria-busy', 'false');
  expect(calls('github_list_folder')).toHaveLength(2);
});

it('a failed Refresh keeps the rows and shows an error line with Retry', async () => {
  const { user } = await openRepoTree();
  await screen.findByText('a.md');
  handlers.github_list_folder = () => {
    throw { kind: 'network', message: 'timed out' };
  };
  await user.click(refreshBtn());
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Could not reach GitHub while refreshing the navigator. Could not reach GitHub: timed out');
  expect(screen.getByText('a.md')).toBeInTheDocument();
  handlers.github_list_folder = () => listed([file('c.md')]);
  await user.click(within(alert).getByRole('button', { name: 'Retry' }));
  await screen.findByText('c.md');
  expect(screen.queryByRole('alert')).toBeNull();
});

it('a plain Refresh lists a branch added upstream in the branch sheet and keeps the branch', async () => {
  const { user } = await openRepoTree();
  await screen.findByText('a.md');
  handlers.github_list_branches = () => ({ default_branch: 'main', branches: ['main', 'dev', 'hotfix'], next_page: null });
  await user.click(refreshBtn());
  await settled();
  await user.click(screen.getByRole('button', { name: 'Branch: main' }));
  const list = await screen.findByRole('listbox', { name: 'Branches' });
  expect(await within(list).findByText('hotfix')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
});

it('when the open branch was deleted, Refresh moves to the default branch', async () => {
  handlers.github_list_repos = () => ({
    repos: [{ owner: 'o', name: 'r', full_name: 'o/r', private: false, default_branch: 'feature', can_push: true, pushed_at: null }],
    next_page: null,
  });
  handlers.github_list_branches = () => ({ default_branch: 'main', branches: ['main', 'feature'], next_page: null });
  const { user } = await openRepoTree();
  await screen.findByText('a.md');
  handlers.github_list_folder = (a) => {
    if (a.branch === 'feature') throw { kind: 'branch_not_found', message: 'gone' };
    return listed([file('on-main.md')]);
  };
  await user.click(refreshBtn());
  expect(await screen.findByText('on-main.md')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
  expect(screen.queryByText(/no longer exists/)).toBeNull();
});

it('lists branches as check mark and name only (no default badge), filters them and picking one reloads the tree', async () => {
  const { user } = await openRepoTree();
  await screen.findByText('a.md');
  await user.click(screen.getByRole('button', { name: 'Branch: main' }));
  const list = await screen.findByRole('listbox', { name: 'Branches' });
  await waitFor(() => expect(within(list).getAllByRole('option')).toHaveLength(2));
  expect(within(list).getByRole('option', { name: /main/ })).toHaveAttribute('aria-selected', 'true');
  expect(screen.queryByText(/default/i)).toBeNull();
  await user.type(screen.getByPlaceholderText('Filter branches'), 'zzz');
  expect(screen.getByText('No branch matches.')).toBeInTheDocument();
  await user.clear(screen.getByPlaceholderText('Filter branches'));
  await user.type(screen.getByPlaceholderText('Filter branches'), 'DE');
  await user.click(within(list).getByRole('option', { name: /dev/ }));
  await waitFor(() => expect(calls('github_list_folder').at(-1)![1]).toMatchObject({ branch: 'dev' }));
  expect(screen.getByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('branch sheet states: Loading more…, the 100 cap line, No branches. and an error with Retry', async () => {
  const names = Array.from({ length: 150 }, (_, i) => `b${i}`);
  const second = deferred();
  handlers.github_list_branches = (a) => ((a as { page: number }).page === 1 ? { default_branch: 'main', branches: names, next_page: 2 } : second.p);
  const { user } = await openRepoTree();
  await screen.findByText('a.md');
  await user.click(screen.getByRole('button', { name: 'Branch: main' }));
  expect(await screen.findByText('Showing the first 100 of 150 branches. Type to narrow the list.')).toBeInTheDocument();
  expect(screen.getByText('Loading more…')).toBeInTheDocument();
  expect(within(screen.getByRole('listbox')).getAllByRole('option')).toHaveLength(100);
  await act(async () => second.resolve({ default_branch: 'main', branches: [], next_page: null }));
  await waitFor(() => expect(screen.queryByText('Loading more…')).toBeNull());
});

it('branch sheet: No branches. for an empty list, and an error with Retry', async () => {
  let fail = true;
  handlers.github_list_branches = () => {
    if (fail) throw { kind: 'network', message: 'offline' };
    return { default_branch: 'main', branches: [], next_page: null };
  };
  const { user } = await openRepoTree();
  await screen.findByText('a.md');
  await user.click(screen.getByRole('button', { name: 'Branch: main' }));
  const sheet = await screen.findByRole('dialog', { name: 'Branches' });
  const alert = await within(sheet).findByRole('alert');
  expect(alert).toHaveTextContent('Could not reach GitHub while loading branches. Could not reach GitHub: offline');
  fail = false;
  await user.click(within(alert).getByRole('button', { name: 'Retry' }));
  expect(await within(sheet).findByText('No branches.')).toBeInTheDocument();
});

it('shows the empty texts for the root and a subfolder, Show more (N more) after 200 rows and the truncated note', async () => {
  const many = Array.from({ length: 205 }, (_, i) => file(`m${String(i).padStart(3, '0')}.md`));
  handlers.github_list_folder = (a) => (a.path === 'sub' ? listed([]) : listed([folder('sub'), ...many], true));
  const { user } = await openRepoTree();
  await screen.findByText('m000.md');
  expect(screen.getByRole('note')).toHaveTextContent('Showing what GitHub returned; the folder may have more.');
  await user.click(screen.getByRole('button', { name: /sub/ }));
  expect(await screen.findByText('No Markdown files in this folder.')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Show more (6 more)' }));
  expect(screen.getByText('m204.md')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Show more/ })).toBeNull();
});

it('an empty branch says No Markdown files in this branch.', async () => {
  handlers.github_list_folder = () => listed([]);
  await openRepoTree();
  expect(await screen.findByText('No Markdown files in this branch.')).toBeInTheDocument();
});

it.each([
  ['empty_repo', 'x', 'This repository is empty: it has no commits yet.', null],
  ['branch_not_found', 'x', 'The branch “main” no longer exists on GitHub. Choose another branch.', null],
  ['not_signed_in', 'x', 'Sign in to GitHub to browse this repository.', 'Sign in'],
  ['network', 'timed out', 'Could not reach GitHub while listing this folder. Could not reach GitHub: timed out', 'Retry'],
  ['other', 'Boom', 'Boom', 'Retry'],
])('a %s root listing error reads as on the desktop', async (kind, message, text, action) => {
  handlers.github_list_folder = () => {
    throw { kind, message };
  };
  await openRepoTree();
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(text));
  const alert = screen.getByRole('alert');
  if (action === null) expect(within(alert).queryByRole('button')).toBeNull();
  else expect(within(alert).getByRole('button', { name: action })).toBeInTheDocument();
});

it('a rate-limited folder says when to try again', async () => {
  const resetAt = Math.floor(new Date(2026, 9, 31, 14, 7).getTime() / 1000);
  handlers.github_list_folder = () => {
    throw { kind: 'rate_limited', message: 'slow down', reset_at: resetAt, resetAt };
  };
  await openRepoTree();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent(/^GitHub rate limit reached\. Try again (after \d{1,2}:\d{2}.*|later)\./);
  expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
});

it('tapping a file opens it as a github:// document in the editor', async () => {
  handlers.github_read_file = () => ({ path: 'a.md', name: 'a.md', content: '# Hello', sha: 's1', commit_sha: 'c1' });
  const { user } = await openRepoTree();
  await user.click(await screen.findByRole('button', { name: 'a.md' }));
  expect(await screen.findByRole('switch', { name: 'Raw Markdown' })).toBeInTheDocument();
  expect(calls('github_read_file')[0][1]).toEqual({ owner: 'o', repo: 'r', branch: 'main', path: 'a.md' });
  await user.click(screen.getByRole('button', { name: 'Back' }));
  const row = await screen.findByRole('button', { name: 'a.md' });
  expect(row).toHaveAttribute('aria-current', 'true');
});
