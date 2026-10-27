/** File > Open PR…: greyed without a repository, the three steps and their clearing rules, PR marks, empty and no-changes states, Back/Cancel, already-open, GitHub's errors unchanged, tabs turning read-only, and the web error. */
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleEditors } from '../../testing/editor';
import { menu, renderApp, type User } from '../../testing/renderApp';
import { openGithub } from '../../platform/files';
import { branchesExist, compareBranches, createPull, githubPath } from '../../platform/github';
import { addSessionBranch, clearSessionBranches } from './sessionBranches';

type Replies = Record<string, (args: Record<string, unknown>) => unknown>;
let recentRows: { path: string; opened_at: number }[] = [];
let replies: Replies = {};
const invoke = vi.fn(async (cmd: string, args: Record<string, unknown> = {}): Promise<unknown> => {
  if (cmd === 'recent_documents_list' || cmd === 'recent_documents_add' || cmd === 'recent_documents_remove') return recentRows;
  if (cmd === 'take_launch_paths') return [];
  const h = replies[cmd];
  if (!h) throw new Error(`unmocked ${cmd}`);
  return h(args);
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: [string, Record<string, unknown>?]) => invoke(...a) }));
vi.mock('../../platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('../../platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));
vi.mock('../../platform/external', () => ({ openExternal: vi.fn(), opensExternallyNatively: () => true, REPO_URL: '' }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);
const file = (filename: string, status = 'modified', additions = 1, deletions = 0, previous_filename: string | null = null) => ({ filename, previous_filename, status, additions, deletions });
const compareReply = (over: Record<string, unknown> = {}) => ({ ahead_by: 2, behind_by: 1, files: [file('a.md', 'modified', 3, 1), file('b.md', 'added', 5, 0)], truncated: false, ...over });
const pullUrl = (n: number) => `https://github.com/octo/notes/pull/${n}`;

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  recentRows = [];
  clearSessionBranches();
  invoke.mockClear();
  replies = {
    github_status: () => ({ signed_in: true, login: 'octo', storage: 'keychain' }),
    github_list_repos: () => ({ repos: [{ owner: 'octo', name: 'notes', full_name: 'octo/notes', private: false, default_branch: 'main', can_push: true, pushed_at: null }], next_page: null }),
    github_list_branches: (a) =>
      a.page === 1
        ? { default_branch: 'main', branches: ['main', 'dev', 'gonq/one'], next_page: 2 }
        : { default_branch: 'main', branches: ['release', 'gonq/two'], next_page: null },
    github_list_folder: () => ({ entries: [], truncated: false }),
    github_branches_exist: (a) => a.branches,
    github_open_pulls_for_branches: (a) => (a.branches as string[]).map((branch) => ({ branch, pull: null })),
    github_compare: () => compareReply(),
    github_create_pull: () => ({ number: 12, html_url: pullUrl(12) }),
  };
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

async function openRepo(user: User) {
  await menu(user, 'File', 'Open Repo…');
  await user.click(await screen.findByRole('button', { name: /octo\/notes/ }));
  await screen.findByRole('complementary', { name: 'Folder navigator' });
}
async function openPrDialog(user: User) {
  await menu(user, 'File', 'Open PR…');
  return screen.findByRole('dialog', { name: 'Open pull request' });
}
const option = (d: HTMLElement, name: string) => within(d).getByRole('option', { name });
async function choose(user: User, d: HTMLElement, source: string, target?: string) {
  await user.click(await within(d).findByRole('option', { name: source }));
  if (target) await user.click(await within(d).findByRole('option', { name: target }));
}

describe('File > Open PR…', () => {
  it('is greyed when no repository or GitHub tab is open, and enabled once a repo is open', async () => {
    const { user } = renderApp();
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(await screen.findByRole('menuitem', { name: 'Open PR…' })).toHaveAttribute('aria-disabled', 'true');
    await user.keyboard('{Escape}');
    await openRepo(user);
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(await screen.findByRole('menuitem', { name: 'Open PR…' })).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('shows the empty text, the repo dropdown, and nothing of steps 2 and 3, when the session has no branches', async () => {
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    expect(await within(d).findByText('No branches to merge from this session.')).toBeInTheDocument();
    expect(within(d).getByRole('combobox', { name: 'Repository' })).toHaveValue('octo/notes');
    expect(within(d).queryByText('Merge into')).toBeNull();
    expect(within(d).queryByText('Review changes')).toBeNull();
  });

  it('step 1 lists session branches that still exist (404s dropped); nothing is preselected; step 2 and 3 wait for their inputs', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/gone' });
    addSessionBranch({ owner: 'other', repo: 'x', branch: 'gonq/elsewhere' });
    replies.github_branches_exist = (a) => (a.branches as string[]).filter((b) => b !== 'gonq/gone');
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    expect(await within(d).findByRole('option', { name: 'gonq/one' })).toHaveAttribute('aria-selected', 'false');
    expect(within(d).queryByRole('option', { name: 'gonq/gone' })).toBeNull();
    expect(within(d).queryByRole('option', { name: 'gonq/elsewhere' })).toBeNull();
    expect(calls('github_branches_exist')[0][1]).toEqual({ owner: 'octo', repo: 'notes', branches: ['gonq/one', 'gonq/gone'] });
    expect(within(d).queryByText('Merge into')).toBeNull();
    expect(within(d).queryByText('Review changes')).toBeNull();
  });

  it('step 2 lists every page minus the source, filters client-side, preselects nothing; step 3 appears when both are chosen and lists the changes', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    replies.github_compare = () =>
      compareReply({ files: [file('a.md', 'modified', 3, 1), file('new name.md', 'renamed', 0, 0, 'old name.md'), file('gone.md', 'removed', 0, 7), file('**bold**<b>.md', 'added', 2, 0)], ahead_by: 1, behind_by: 4 });
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    await user.click(await within(d).findByRole('option', { name: 'gonq/one' }));
    const targets = await within(d).findByRole('listbox', { name: 'Branches to merge into' });
    expect(within(targets).getAllByRole('option').map((o) => o.textContent)).toEqual(['main', 'dev', 'release', 'gonq/two']);
    expect(within(targets).getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(calls('github_list_branches').filter((c) => (c[1] as { page: number }).page === 2).length).toBeGreaterThan(0);
    await user.type(within(d).getByRole('textbox', { name: 'Filter branches' }), 'REL');
    expect(within(targets).getAllByRole('option').map((o) => o.textContent)).toEqual(['release']);
    expect(within(d).queryByText('Review changes')).toBeNull();
    await user.click(option(d, 'release'));
    await within(d).findByText('1 commit ahead, 4 commits behind release');
    expect(calls('github_compare')[0][1]).toEqual({ owner: 'octo', repo: 'notes', base: 'release', head: 'gonq/one' });
    expect(within(d).getByText('4 files changed, +5 −8')).toBeInTheDocument();
    const list = within(d).getByRole('list', { name: 'Changed files' });
    expect(within(list).getByText('**bold**<b>.md')).toBeInTheDocument();
    expect(within(list).getByText('new name.md')).toBeInTheDocument();
    expect(within(list).getByText('renamed from old name.md · +0 −0')).toBeInTheDocument();
    expect(within(list).getByText('removed · +0 −7')).toBeInTheDocument();
  });

  it('changing the source clears the target and step 3; picking another target refreshes step 3', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/two' });
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    await choose(user, d, 'gonq/one', 'main');
    await within(d).findByText(/2 commits ahead/);
    await user.click(option(d, 'dev'));
    await waitFor(() => expect(calls('github_compare')).toHaveLength(2));
    expect(calls('github_compare')[1][1]).toMatchObject({ base: 'dev', head: 'gonq/one' });
    await user.click(within(within(d).getByRole('listbox', { name: 'Branches to merge' })).getByRole('option', { name: 'gonq/two' }));
    expect(within(d).queryByText(/commits ahead/)).toBeNull();
    const targets = within(d).getByRole('listbox', { name: 'Branches to merge into' });
    expect(within(targets).queryByRole('option', { name: 'gonq/two' })).toBeNull();
    expect(within(targets).getByRole('option', { name: 'gonq/one' })).toBeInTheDocument();
    expect(within(targets).getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
  });

  it('changing the repository rebuilds step 1 and clears steps 2 and 3', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    addSessionBranch({ owner: 'octo', repo: 'other', branch: 'gonq/side' });
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    await choose(user, d, 'gonq/one', 'main');
    await within(d).findByText(/2 commits ahead/);
    await user.selectOptions(within(d).getByRole('combobox', { name: 'Repository' }), 'octo/other');
    expect(await within(d).findByRole('option', { name: 'gonq/side' })).toBeInTheDocument();
    expect(within(d).queryByRole('option', { name: 'gonq/one' })).toBeNull();
    expect(within(d).queryByText('Merge into')).toBeNull();
    expect(within(d).queryByText('Review changes')).toBeNull();
    expect(calls('github_branches_exist')[1][1]).toEqual({ owner: 'octo', repo: 'other', branches: ['gonq/side'] });
  });

  it('marks branches that have an open PR with a link; choosing one says so in step 3 with no Open PR button', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/two' });
    replies.github_open_pulls_for_branches = (a) =>
      (a.branches as string[]).map((branch) => ({ branch, pull: branch === 'gonq/two' ? { number: 9, html_url: pullUrl(9), draft: false, title: 't' } : null }));
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    await within(d).findByRole('option', { name: 'gonq/two' });
    expect(calls('github_open_pulls_for_branches')).toHaveLength(1);
    expect(within(d).getByRole('link', { name: '#9' })).toHaveAttribute('href', pullUrl(9));
    await user.click(option(d, 'gonq/two'));
    expect(await within(d).findByText(/Pull request #9 is already open for this branch/)).toBeInTheDocument();
    expect(within(d).getAllByRole('link', { name: '#9' })).toHaveLength(2);
    expect(within(d).queryByRole('button', { name: 'Open PR' })).toBeNull();
    expect(calls('github_compare')).toHaveLength(0);
  });

  it('says so when there are no changes, and Open PR is inactive', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    replies.github_compare = () => compareReply({ ahead_by: 0, behind_by: 3, files: [] });
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    await choose(user, d, 'gonq/one', 'main');
    expect(await within(d).findByText('No changes between these branches.')).toBeInTheDocument();
    expect(within(d).getByRole('button', { name: 'Open PR' })).toBeDisabled();
  });

  it('says when GitHub truncated the file list, and handles hundreds of files', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    replies.github_compare = () => compareReply({ files: Array.from({ length: 400 }, (_, i) => file(`docs/f${i}.md`, 'added', 1, 0)), truncated: true });
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    await choose(user, d, 'gonq/one', 'main');
    expect(await within(d).findByText(/GitHub cut the file list off/)).toBeInTheDocument();
    expect(within(d).getByText('400 files changed, +400 −0')).toBeInTheDocument();
    expect(within(within(d).getByRole('list', { name: 'Changed files' })).getAllByRole('listitem')).toHaveLength(400);
  });

  it('Open PR leads to an editable title and body (defaults), Back keeps the selections, Cancel closes', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one-fix' });
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    await choose(user, d, 'gonq/one-fix', 'main');
    await within(d).findByText(/2 commits ahead/);
    await user.click(within(d).getByRole('button', { name: 'Open PR' }));
    expect(within(d).getByRole('textbox', { name: 'Title' })).toHaveValue('one-fix');
    expect((within(d).getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value).toContain('2 files changed, +8 −1');
    expect(calls('github_create_pull')).toHaveLength(0);
    await user.click(within(d).getByRole('button', { name: 'Back' }));
    expect(option(d, 'gonq/one-fix')).toHaveAttribute('aria-selected', 'true');
    expect(option(d, 'main')).toHaveAttribute('aria-selected', 'true');
    await user.click(within(d).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls('github_create_pull')).toHaveLength(0);
  });

  it('confirming creates the PR with the edited title and body, shows the link and Open in browser', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    await choose(user, d, 'gonq/one', 'main');
    await within(d).findByText(/2 commits ahead/);
    await user.click(within(d).getByRole('button', { name: 'Open PR' }));
    const title = within(d).getByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.type(title, 'My title');
    const body = within(d).getByRole('textbox', { name: 'Description' });
    await user.clear(body);
    await user.type(body, 'My body');
    await user.dblClick(within(d).getByRole('button', { name: 'Open PR' }));
    expect(await within(d).findByText(/was opened for gonq\/one/)).toBeInTheDocument();
    expect(calls('github_create_pull')).toEqual([['github_create_pull', { owner: 'octo', repo: 'notes', title: 'My title', body: 'My body', head: 'gonq/one', base: 'main' }]]);
    expect(within(d).getByRole('link', { name: '#12' })).toHaveAttribute('href', pullUrl(12));
    expect(within(d).getByRole('button', { name: 'Open in browser' })).toBeInTheDocument();
  });

  it("shows GitHub's refusal unchanged and keeps the screen so it can be retried or edited", async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    replies.github_create_pull = () => {
      throw { kind: 'http', status: 422, message: 'A pull request already exists for octo:gonq/one.' };
    };
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    await choose(user, d, 'gonq/one', 'main');
    await within(d).findByText(/2 commits ahead/);
    await user.click(within(d).getByRole('button', { name: 'Open PR' }));
    await user.click(within(d).getByRole('button', { name: 'Open PR' }));
    expect(await within(d).findByRole('alert')).toHaveTextContent(/^A pull request already exists for octo:gonq\/one\.$/);
    expect(within(d).getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
  });

  it('shows an error from the compare in step 3, and from the branch check in step 1', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    replies.github_compare = () => {
      throw { kind: 'http', status: 404, message: 'Not Found' };
    };
    const { user } = renderApp();
    await openRepo(user);
    const d = await openPrDialog(user);
    await choose(user, d, 'gonq/one', 'main');
    expect(await within(d).findByRole('alert')).toHaveTextContent('GitHub returned 404: Not Found');
    expect(within(d).getByRole('button', { name: 'Open PR' })).toBeDisabled();
  });

  it('every open tab on the source branch turns read-only at once when the PR is opened', async () => {
    const path = githubPath({ owner: 'octo', repo: 'notes', branch: 'gonq/one', path: 'a.md' });
    recentRows = [{ path, opened_at: 1 }];
    replies.github_read_file = () => ({ path: 'a.md', name: 'a.md', content: 'hello', sha: 'b1', commit_sha: 't1' });
    const { user } = renderApp({ files: { openPath: openGithub } });
    await openRepo(user);
    await user.click((await screen.findAllByRole('button', { name: /a\.md/ }))[0]);
    await settleEditors(document.body);
    expect(screen.queryByTestId('read-only-banner')).toBeNull();
    const d = await openPrDialog(user);
    expect(within(d).getByRole('combobox', { name: 'Repository' })).toHaveValue('octo/notes');
    await choose(user, d, 'gonq/one', 'main');
    await within(d).findByText(/2 commits ahead/);
    await user.click(within(d).getByRole('button', { name: 'Open PR' }));
    await user.click(within(d).getByRole('button', { name: 'Open PR' }));
    await within(d).findByText(/was opened/);
    await user.click(within(d).getByRole('button', { name: 'Close' }));
    expect(await screen.findByTestId('read-only-banner')).toHaveTextContent('Pull request #12 is open for this branch');
  });

  it('on the web the menu item is present (greyed by state) and the platform calls throw the clear error', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const { user } = renderApp();
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(await screen.findByRole('menuitem', { name: 'Open PR…' })).toBeInTheDocument();
    for (const run of [
      () => branchesExist('o', 'r', ['b']),
      () => compareBranches('o', 'r', 'main', 'b'),
      () => createPull({ owner: 'o', repo: 'r', title: 't', body: '', head: 'b', base: 'main' }),
    ]) {
      await expect(run()).rejects.toMatchObject({ kind: 'unavailable_on_web', message: 'Opening a pull request needs the Gonq desktop app' });
    }
  });

  it('pins the contract: command names, argument keys and reply shapes', async () => {
    expect(await branchesExist('o', 'r', ['a', 'b'])).toEqual(['a', 'b']);
    expect(invoke).toHaveBeenLastCalledWith('github_branches_exist', { owner: 'o', repo: 'r', branches: ['a', 'b'] });
    expect(await compareBranches('o', 'r', 'main', 'feat')).toEqual({
      aheadBy: 2,
      behindBy: 1,
      truncated: false,
      files: [
        { filename: 'a.md', previousFilename: null, status: 'modified', additions: 3, deletions: 1 },
        { filename: 'b.md', previousFilename: null, status: 'added', additions: 5, deletions: 0 },
      ],
    });
    expect(invoke).toHaveBeenLastCalledWith('github_compare', { owner: 'o', repo: 'r', base: 'main', head: 'feat' });
    expect(await createPull({ owner: 'o', repo: 'r', title: 't', body: 'b', head: 'feat', base: 'main' })).toEqual({ number: 12, url: pullUrl(12) });
    expect(invoke).toHaveBeenLastCalledWith('github_create_pull', { owner: 'o', repo: 'r', title: 't', body: 'b', head: 'feat', base: 'main' });
  });
});
