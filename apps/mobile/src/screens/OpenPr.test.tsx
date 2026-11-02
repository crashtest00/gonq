/** Covers the mobile Open PR flow through renderMobileApp, porting desktop openPr.test.tsx, openPrLabelNote.test.tsx and the title/body defaults of prDefaults.test.ts: entry from the ⋯ menu, the stacked review sections and their clearing rules, PR marks, empty/loading/no-change/truncated states, the details screen (defaults, Back discards edits, Cancel), creating the pull request, the result screen and label note, GitHub's errors in the banner, tabs turning read-only, and the 44px hit areas. */
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
const openUrl = vi.fn(async () => {});
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

import { settleEditors } from '@gonq/editor/testing/editor';
import { addSessionBranch, clearSessionBranches } from '@gonq/editor/features/github/sessionBranches';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);
const file = (filename: string, status = 'modified', additions = 1, deletions = 0, previous_filename: string | null = null) => ({ filename, previous_filename, status, additions, deletions });
const compareReply = (over: Record<string, unknown> = {}) => ({ ahead_by: 2, behind_by: 1, files: [file('a.md', 'modified', 3, 1), file('b.md', 'added', 5, 0)], truncated: false, ...over });
const pullUrl = (n: number) => `https://github.com/octo/notes/pull/${n}`;
const repoRow = (name: string) => ({ owner: 'octo', name, full_name: `octo/${name}`, private: false, default_branch: 'main', can_push: true, pushed_at: null });

beforeEach(() => {
  invoke.mockReset();
  openUrl.mockClear();
  clearSessionBranches();
  handlers = {
    github_status: () => ({ signed_in: true, login: 'octo', storage: 'keychain' }),
    github_list_repos: () => ({ repos: [repoRow('notes')], next_page: null }),
    github_list_branches: (a) =>
      a.page === 1
        ? { default_branch: 'main', branches: ['main', 'dev', 'gonq/one'], next_page: 2 }
        : { default_branch: 'main', branches: ['release', 'gonq/two'], next_page: null },
    github_list_folder: () => ({ entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false }),
    github_read_file: (a) => ({ path: a.path, name: 'a.md', content: 'hello', sha: 'b1', commit_sha: 't1' }),
    github_branches_exist: (a) => a.branches,
    github_open_pulls_for_branches: (a) => (a.branches as string[]).map((branch) => ({ branch, pull: null })),
    github_compare: () => compareReply(),
    github_create_pull: () => ({ number: 12, html_url: pullUrl(12) }),
    recent_documents_list: () => [],
    recent_documents_add: () => [],
  };
  invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => handlers[cmd]?.(args ?? {}));
});

async function openRepo() {
  const r = await renderMobileApp();
  await r.user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await r.user.click(await screen.findByRole('button', { name: /octo\/notes/ }));
  await screen.findByRole('heading', { name: 'octo/notes' });
  return r;
}
/** The repo screen has no ⋯ menu, so the flow is started from the Documents home (the repository stays open). */
async function openPr(user: User) {
  if (!screen.queryByRole('button', { name: 'More' })) await user.click(screen.getByRole('button', { name: 'Back' }));
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Open PR…' }));
  return screen.findByRole('heading', { name: 'Open pull request' });
}
const option = (name: string) => screen.getByRole('option', { name });
async function choose(user: User, source: string, target?: string) {
  await user.click(await screen.findByRole('option', { name: source }));
  if (target) await user.click(await screen.findByRole('option', { name: target }));
}
async function ready(source = 'gonq/one', target = 'main') {
  addSessionBranch({ owner: 'octo', repo: 'notes', branch: source });
  const r = await openRepo();
  await openPr(r.user);
  await choose(r.user, source, target);
  await screen.findByText(/commits? ahead/);
  return r;
}

describe('entry', () => {
  it('is greyed in the ⋯ menu with no repository or GitHub tab', async () => {
    const { user } = await renderMobileApp();
    await user.click(screen.getByRole('button', { name: 'More' }));
    expect(await screen.findByRole('menuitem', { name: 'Open PR…' })).toBeDisabled();
  });

  it('shows the empty text and the Repository selector, and nothing of Merge into or Review changes, when the session has no branches', async () => {
    const { user } = await openRepo();
    await openPr(user);
    expect(await screen.findByText('No branches to merge from this session.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Repository' })).toHaveValue('octo/notes');
    expect(screen.queryByRole('heading', { name: 'Merge into' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Review changes' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled();
  });

  it('says "Checking branches…" while the branches are checked', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    let release!: (v: unknown) => void;
    handlers.github_branches_exist = (a) => new Promise((r) => (release = () => r(a.branches)));
    const { user } = await openRepo();
    await openPr(user);
    expect(await screen.findByText('Checking branches…')).toBeInTheDocument();
    await act(async () => release(null));
    expect(await screen.findByRole('option', { name: 'gonq/one' })).toBeInTheDocument();
    expect(screen.queryByText('Checking branches…')).toBeNull();
  });
});

describe('review screen', () => {
  it('lists session branches that still exist (404s dropped) with nothing preselected and no ahead counts', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/gone' });
    addSessionBranch({ owner: 'other', repo: 'x', branch: 'gonq/elsewhere' });
    handlers.github_branches_exist = (a) => (a.branches as string[]).filter((b) => b !== 'gonq/gone');
    const { user } = await openRepo();
    await openPr(user);
    expect(await screen.findByRole('option', { name: 'gonq/one' })).toHaveAttribute('aria-selected', 'false');
    expect(screen.queryByRole('option', { name: 'gonq/gone' })).toBeNull();
    expect(screen.queryByRole('option', { name: 'gonq/elsewhere' })).toBeNull();
    expect(calls('github_branches_exist')[0][1]).toEqual({ owner: 'octo', repo: 'notes', branches: ['gonq/one', 'gonq/gone'] });
    expect(screen.queryByText(/ahead/)).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Merge into' })).toBeNull();
  });

  it('includes the branch of an open GitHub tab and the tab repository', async () => {
    handlers.github_list_folder = () => ({ entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false });
    const { user } = await openRepo();
    await user.click(await screen.findByRole('button', { name: 'a.md' }));
    await screen.findByRole('switch', { name: 'Raw Markdown' });
    await settleEditors(document.body);
    await openPr(user);
    expect(await screen.findByRole('option', { name: 'main' })).toBeInTheDocument();
  });

  it('Merge into lists every page minus the source, filters client-side, preselects nothing; Review changes lists the changes', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    handlers.github_compare = () =>
      compareReply({ files: [file('a.md', 'modified', 3, 1), file('new name.md', 'renamed', 0, 0, 'old name.md'), file('gone.md', 'removed', 0, 7), file('**bold**<b>.md', 'added', 2, 0)], ahead_by: 1, behind_by: 4 });
    const { user } = await openRepo();
    await openPr(user);
    await user.click(await screen.findByRole('option', { name: 'gonq/one' }));
    const targets = await screen.findByRole('listbox', { name: 'Branches to merge into' });
    expect(within(targets).getAllByRole('option').map((o) => o.textContent)).toEqual(['main', 'dev', 'release', 'gonq/two']);
    expect(within(targets).getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(within(targets).queryByText('default')).toBeNull();
    expect(calls('github_list_branches').filter((c) => (c[1] as { page: number }).page === 2).length).toBeGreaterThan(0);
    await user.type(screen.getByRole('textbox', { name: 'Filter branches' }), 'REL');
    expect(within(targets).getAllByRole('option').map((o) => o.textContent)).toEqual(['release']);
    expect(screen.queryByRole('heading', { name: 'Review changes' })).toBeNull();
    await user.click(option('release'));
    await screen.findByText('1 commit ahead, 4 commits behind release');
    expect(calls('github_compare')[0][1]).toEqual({ owner: 'octo', repo: 'notes', base: 'release', head: 'gonq/one' });
    expect(screen.getByText('4 files changed, +5 −8')).toBeInTheDocument();
    const list = screen.getByRole('list', { name: 'Changed files' });
    expect(within(list).getAllByRole('listitem')).toHaveLength(4);
    expect(within(list).getByText('**bold**<b>.md')).toBeInTheDocument();
    expect(within(list).getByText('renamed from old name.md · +0 −0')).toBeInTheDocument();
    expect(within(list).getByText('removed · +0 −7')).toBeInTheDocument();
    expect(within(list).getByText('added · +2 −0')).toBeInTheDocument();
  });

  it('shows "Loading branches…" and the first-100 cap note', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    let release!: () => void;
    handlers.github_list_branches = () =>
      new Promise((r) => (release = () => r({ default_branch: 'main', branches: ['gonq/one', ...Array.from({ length: 150 }, (_, i) => `b${i}`)], next_page: null })));
    const { user } = await openRepo();
    await openPr(user);
    await user.click(await screen.findByRole('option', { name: 'gonq/one' }));
    expect(await screen.findByText('Loading branches…')).toBeInTheDocument();
    await act(async () => release());
    const targets = await screen.findByRole('listbox', { name: 'Branches to merge into' });
    expect(within(targets).getAllByRole('option')).toHaveLength(100);
    expect(screen.getByText('Showing the first 100 of 150; type to narrow the list.')).toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Filter branches' }), 'b14');
    expect(screen.queryByText(/Showing the first/)).toBeNull();
  });

  it('changing the source clears the target and the review; picking another target refreshes the review', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/two' });
    const { user } = await openRepo();
    await openPr(user);
    await choose(user, 'gonq/one', 'main');
    await screen.findByText(/2 commits ahead/);
    await user.click(option('dev'));
    await waitFor(() => expect(calls('github_compare')).toHaveLength(2));
    expect(calls('github_compare')[1][1]).toMatchObject({ base: 'dev', head: 'gonq/one' });
    await user.click(within(screen.getByRole('listbox', { name: 'Branches to merge' })).getByRole('option', { name: 'gonq/two' }));
    expect(screen.queryByText(/commits ahead/)).toBeNull();
    const targets = screen.getByRole('listbox', { name: 'Branches to merge into' });
    expect(within(targets).queryByRole('option', { name: 'gonq/two' })).toBeNull();
    expect(within(targets).getByRole('option', { name: 'gonq/one' })).toBeInTheDocument();
    expect(within(targets).getAllByRole('option').every((o) => o.getAttribute('aria-selected') === 'false')).toBe(true);
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled();
  });

  it('changing the repository rebuilds the branch list and clears the other selections', async () => {
    handlers.github_list_repos = () => ({ repos: [repoRow('notes'), repoRow('other')], next_page: null });
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    addSessionBranch({ owner: 'octo', repo: 'other', branch: 'gonq/side' });
    const { user } = await openRepo();
    await openPr(user);
    await choose(user, 'gonq/one', 'main');
    await screen.findByText(/2 commits ahead/);
    expect(within(screen.getByRole('combobox', { name: 'Repository' })).getAllByRole('option').map((o) => o.textContent)).toEqual(['octo/notes', 'octo/other']);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Repository' }), 'octo/other');
    expect(await screen.findByRole('option', { name: 'gonq/side' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'gonq/one' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Merge into' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Review changes' })).toBeNull();
    expect(calls('github_branches_exist')[1][1]).toEqual({ owner: 'octo', repo: 'other', branches: ['gonq/side'] });
  });

  it('marks branches with an open PR with a link; choosing one says so with no Open PR button and no comparison', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/two' });
    handlers.github_open_pulls_for_branches = (a) =>
      (a.branches as string[]).map((branch) => ({ branch, pull: branch === 'gonq/two' ? { number: 9, html_url: pullUrl(9), draft: false, title: 't' } : null }));
    const { user } = await openRepo();
    await openPr(user);
    await screen.findByRole('option', { name: 'gonq/two' });
    expect(calls('github_open_pulls_for_branches')).toHaveLength(1);
    expect(screen.getByRole('link', { name: '#9' })).toHaveAttribute('href', pullUrl(9));
    await user.click(option('gonq/two'));
    expect(await screen.findByText(/Pull request #9 is already open for this branch/)).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: '#9' })).toHaveLength(2);
    expect(screen.queryByRole('button', { name: 'Open PR' })).toBeNull();
    expect(calls('github_compare')).toHaveLength(0);
    await user.click(screen.getAllByRole('link', { name: '#9' })[0]);
    expect(openUrl).toHaveBeenCalledWith(pullUrl(9));
  });

  it('says "Comparing…" then, with no changes, says so and keeps Open PR disabled', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    let release!: () => void;
    handlers.github_compare = () => new Promise((r) => (release = () => r(compareReply({ ahead_by: 0, behind_by: 3, files: [] }))));
    const { user } = await openRepo();
    await openPr(user);
    await choose(user, 'gonq/one', 'main');
    expect(await screen.findByText('Comparing…')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled();
    await act(async () => release());
    expect(await screen.findByText('No changes between these branches.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled();
  });

  it('says when GitHub truncated the file list, and lists hundreds of files', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    handlers.github_compare = () => compareReply({ files: Array.from({ length: 400 }, (_, i) => file(`docs/f${i}.md`, 'added', 1, 0)), truncated: true });
    const { user } = await openRepo();
    await openPr(user);
    await choose(user, 'gonq/one', 'main');
    expect(await screen.findByText('GitHub cut the file list off, so some changed files are not listed and the totals cover only those shown.')).toBeInTheDocument();
    expect(screen.getByText('400 files changed, +400 −0')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Changed files' })).getAllByRole('listitem')).toHaveLength(400);
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeEnabled();
  });

  it('is labelled Open PR, never Next or Open pull request', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    const { user } = await openRepo();
    await openPr(user);
    expect(screen.queryByRole('button', { name: /Next|Open pull request/ })).toBeNull();
    await choose(user, 'gonq/one', 'main');
    await screen.findByText(/2 commits ahead/);
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeEnabled();
  });

  it('shows errors in the banner: a failed compare (Open PR stays disabled), a failed pull lookup (branches still listed) and a failed branch check', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    handlers.github_compare = () => {
      throw { kind: 'http', status: 404, message: 'Not Found' };
    };
    handlers.github_open_pulls_for_branches = () => {
      throw { kind: 'http', status: 403, message: 'rate limited' };
    };
    const { user } = await openRepo();
    await openPr(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub returned 403: rate limited');
    await choose(user, 'gonq/one', 'main');
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('GitHub returned 404: Not Found'));
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeDisabled();
  });

  it('a failed branch check shows its message in the banner and lists nothing', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    handlers.github_branches_exist = () => {
      throw { kind: 'http', status: 500, message: 'boom' };
    };
    const { user } = await openRepo();
    await openPr(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub returned 500: boom');
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(screen.queryByText('No branches to merge from this session.')).toBeNull();
  });
});

describe('details screen', () => {
  it('Open PR leads to the header, Title and Description defaults; Back discards edits and rebuilds the defaults; Cancel closes without creating', async () => {
    const { user } = await ready('gonq/one-fix');
    await user.click(screen.getByRole('button', { name: 'Open PR' }));
    expect(screen.getByText('octo/notes: gonq/one-fix into main')).toBeInTheDocument();
    const title = screen.getByRole('textbox', { name: 'Title' });
    expect(title).toHaveValue('one-fix');
    const body = screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement;
    expect(body.value).toBe(
      ['Merging gonq/one-fix into main', '', '2 files changed, +8 −1', '', '- modified: a.md (+3 −1)', '- added: b.md (+5 −0)', '', 'Opened from Gonq'].join('\n'),
    );
    expect(calls('github_create_pull')).toHaveLength(0);
    await user.clear(title);
    await user.type(title, 'Edited');
    await user.clear(body);
    await user.type(body, 'Edited body');
    await user.click(within(document.querySelector('main')!).getByRole('button', { name: 'Back' }));
    expect(option('gonq/one-fix')).toHaveAttribute('aria-selected', 'true');
    expect(option('main')).toHaveAttribute('aria-selected', 'true');
    await user.click(screen.getByRole('button', { name: 'Open PR' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('one-fix');
    expect((screen.getByRole('textbox', { name: 'Description' }) as HTMLTextAreaElement).value).toContain('Merging gonq/one-fix into main');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('button', { name: 'Open PR' })).toBeNull();
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    expect(calls('github_create_pull')).toHaveLength(0);
  });

  it('removes exactly one leading gonq/ from the title and keeps other prefixes', async () => {
    const { user } = await openRepo();
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'feature/x' });
    await openPr(user);
    await choose(user, 'feature/x', 'main');
    await screen.findByText(/commits ahead/);
    await user.click(screen.getByRole('button', { name: 'Open PR' }));
    expect(screen.getByRole('textbox', { name: 'Title' })).toHaveValue('feature/x');
  });

  it('shows GitHub\'s refusal unchanged in the banner and stays on the details screen', async () => {
    handlers.github_create_pull = () => {
      throw { kind: 'http', status: 422, message: 'A pull request already exists for octo:gonq/one.' };
    };
    const { user } = await ready();
    await user.click(screen.getByRole('button', { name: 'Open PR' }));
    await user.click(screen.getByRole('button', { name: 'Open PR' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/^A pull request already exists for octo:gonq\/one\.×$/);
    expect(screen.getByRole('textbox', { name: 'Title' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeEnabled();
  });
});

describe('result screen', () => {
  async function toResult(user: User) {
    await user.click(screen.getByRole('button', { name: 'Open PR' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    await user.clear(title);
    await user.type(title, 'My title');
    const body = screen.getByRole('textbox', { name: 'Description' });
    await user.clear(body);
    await user.type(body, 'My body');
    await user.dblClick(screen.getByRole('button', { name: 'Open PR' }));
    await screen.findByRole('heading', { name: 'Pull request opened' });
  }

  it('creates once with the edited text, shows the link and Open in browser, opens the browser, and Close returns', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    const { user } = await openRepo();
    await openPr(user);
    await choose(user, 'gonq/one', 'main');
    await screen.findByText(/2 commits ahead/);
    await toResult(user);
    expect(await screen.findByText(/was opened for gonq\/one\./)).toBeInTheDocument();
    expect(calls('github_create_pull')).toEqual([['github_create_pull', { owner: 'octo', repo: 'notes', title: 'My title', body: 'My body', head: 'gonq/one', base: 'main' }]]);
    expect(screen.getByRole('link', { name: '#12' })).toHaveAttribute('href', pullUrl(12));
    expect(screen.getByRole('link', { name: '#12' }).parentElement!.textContent).toBe('Pull request #12 was opened for gonq/one.');
    expect(screen.queryByRole('note')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Open in browser' }));
    expect(openUrl).toHaveBeenCalledWith(pullUrl(12));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
  });

  it('also shows the label note when the label step failed', async () => {
    handlers.github_create_pull = () => ({ number: 12, html_url: pullUrl(12), label_warning: 'GitHub returned 403: Resource not accessible' });
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    const { user } = await openRepo();
    await openPr(user);
    await choose(user, 'gonq/one', 'main');
    await screen.findByText(/2 commits ahead/);
    await toResult(user);
    expect(await screen.findByRole('note')).toHaveTextContent('Pull request created, but its label could not be added: GitHub returned 403: Resource not accessible');
    expect(screen.getByRole('button', { name: 'Open in browser' })).toBeInTheDocument();
  });

  it('every open tab on the source branch turns read-only at once when the PR is opened', async () => {
    handlers.github_list_branches = () => ({ default_branch: 'gonq/one', branches: ['gonq/one', 'main'], next_page: null });
    handlers.github_list_repos = () => ({ repos: [{ ...repoRow('notes'), default_branch: 'gonq/one' }], next_page: null });
    const { user } = await openRepo();
    await user.click(await screen.findByRole('button', { name: 'a.md' }));
    await screen.findByRole('switch', { name: 'Raw Markdown' });
    await settleEditors(document.body);
    expect(screen.queryByTestId('read-only-banner')).toBeNull();
    await openPr(user);
    await choose(user, 'gonq/one', 'main');
    await screen.findByText(/commits ahead/);
    await toResult(user);
    await user.click(screen.getByRole('button', { name: 'Close' }));
    await waitFor(() => expect(screen.getByText(/Pull request #12 is open for this branch/)).toBeInTheDocument());
  });
});

describe('navigation and layout', () => {
  it('the top bar Back leaves the flow from any screen, and the title follows the phase', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    const { user } = await openRepo();
    await openPr(user);
    await choose(user, 'gonq/one', 'main');
    await screen.findByText(/2 commits ahead/);
    await user.click(screen.getByRole('button', { name: 'Open PR' }));
    expect(screen.getByRole('heading', { name: 'Open pull request' })).toBeInTheDocument();
    await user.click(within(document.querySelector('header')!).getByRole('button', { name: 'Back' }));
    expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
    // The controller's promise is over: Open PR works again.
    await openPr(user);
    expect(await screen.findByRole('option', { name: 'gonq/one' })).toBeInTheDocument();
  });

  it('every control on the review screen is a .m-tap', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    const { user } = await openRepo();
    await openPr(user);
    await choose(user, 'gonq/one', 'main');
    await screen.findByText(/2 commits ahead/);
    const main = document.querySelector('main')!;
    for (const el of main.querySelectorAll('button, select, input, a[href]')) expect(el.className, el.outerHTML.slice(0, 80)).toContain('m-tap');
  });
});
