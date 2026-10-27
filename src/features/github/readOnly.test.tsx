/** Read-only GitHub tabs while a pull request is open for the branch: editor facets, banner and link, Commit/Ctrl+S refusal, greyed Commit item, the re-check before Commit (and its fail-closed message), tabs flipping with the PR, and the web error. */
import { cleanup, createEvent, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { EditorView } from '@codemirror/view';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { settleEditors, type, editorView, docText, select } from '../../testing/editor';
import { openGithub, type FileAccess } from '../../platform/files';
import { GitHubError, githubPath, openPullForBranch, openPullsForBranches } from '../../platform/github';
import { clearSessionBranches } from './sessionBranches';

let recentRows: { path: string; opened_at: number }[] = [];
const reads: Record<string, unknown> = {};
type Pull = { branch: string; number: number; url: string; draft: boolean };
let pulls: Pull[] = [];
let pullsFail = false;
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (cmd === 'recent_documents_list' || cmd === 'recent_documents_add' || cmd === 'recent_documents_remove') return recentRows;
  if (cmd === 'take_launch_paths') return [];
  if (cmd === 'github_status') return { signed_in: true, login: 'me', storage: 'keychain' };
  if (cmd === 'github_list_branches') return { default_branch: 'main', branches: ['main'], next_page: null };
  if (cmd === 'github_list_folder') return { entries: [], truncated: false };
  if (cmd === 'github_read_file') return reads[`${args!.branch}:${args!.path}`];
  if (cmd === 'github_open_pulls_for_branches') {
    if (pullsFail) throw { kind: 'network', message: 'offline' };
    return (args!.branches as string[]).map((branch) => {
      const p = pulls.find((x) => x.branch === branch);
      return { branch, pull: p ? { number: p.number, html_url: p.url, draft: p.draft, title: null } : null };
    });
  }
  if (cmd === 'github_commit_file') return { status: 'committed', sha: 'blob2', commit_sha: 'tip2' };
  return undefined;
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: [string, Record<string, unknown>?]) => invoke(...a) }));
vi.mock('../../platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('../../platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

const loc = { owner: 'octo', repo: 'notes' };
const pr = (branch: string, number = 7, draft = false): Pull => ({ branch, number, draft, url: `https://github.com/octo/notes/pull/${number}` });
const MESSAGE = (n: number) => `Pull request #${n} is open for this branch. You can read this document but not change it.`;
const commits = () => invoke.mock.calls.filter((c) => c[0] === 'github_commit_file');
const pullCalls = () => invoke.mock.calls.filter((c) => c[0] === 'github_open_pulls_for_branches');

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  recentRows = [];
  pulls = [];
  pullsFail = false;
  for (const k of Object.keys(reads)) delete reads[k];
  invoke.mockClear();
  clearSessionBranches();
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

function setup(rows: { branch: string; path: string; content: string }[]) {
  recentRows = rows.map((r, i) => {
    reads[`${r.branch}:${r.path}`] = { path: r.path, name: r.path.split('/').pop(), content: r.content, sha: 'blob1', commit_sha: 'tip1' };
    return { path: githubPath({ ...loc, branch: r.branch, path: r.path }), opened_at: 10 - i };
  });
  const files: FileAccess = { pickDocument: async () => null, saveDocument: vi.fn(), saveDocumentAs: async () => null, openPath: openGithub };
  const user = userEvent.setup();
  render(<App files={files} />);
  return { user };
}

type User = ReturnType<typeof userEvent.setup>;
async function openRecent(user: User, name: RegExp, navigatorOpen = false) {
  if (!navigatorOpen) await user.click(screen.getByTitle('Folder navigator'));
  await user.click(await screen.findByRole('button', { name }));
  await settleEditors(document.body);
}
const banner = () => screen.queryByTestId('read-only-banner');
const commitItem = async (user: User) => {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  return screen.findByRole('menuitem', { name: /^Commit…/ });
};

describe('a tab with an open pull request', () => {
  it('is read-only: facets set, typing and paste blocked, selection and copy work', async () => {
    pulls = [pr('gonq/fix')];
    const { user } = setup([{ branch: 'gonq/fix', path: 'a.md', content: '# A\n\nbody\n' }]);
    await openRecent(user, /^a\.md/);
    await waitFor(() => expect(banner()).not.toBeNull());
    const view = editorView();
    expect(view.state.readOnly).toBe(true);
    expect(view.state.facet(EditorView.editable)).toBe(false);
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false');

    const paste = createEvent.paste(view.contentDOM, { clipboardData: { getData: () => 'PASTED', types: ['text/plain'] } } as unknown as EventInit);
    fireEvent(view.contentDOM, paste);
    expect(docText()).toBe('# A\n\nbody\n');

    select(2, 3);
    expect(view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to)).toBe('A');
    const set = vi.fn();
    fireEvent(view.contentDOM, createEvent.copy(view.contentDOM, { clipboardData: { setData: set, clearData: vi.fn() } } as unknown as EventInit));
    expect(set).toHaveBeenCalledWith('text/plain', 'A');
  });

  it('shows the banner with the PR number and an Open PR link', async () => {
    pulls = [pr('gonq/fix', 12)];
    const { user } = setup([{ branch: 'gonq/fix', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    const b = await screen.findByTestId('read-only-banner');
    expect(b).toHaveTextContent(MESSAGE(12));
    expect(within(b).getByRole('link', { name: 'Open PR' })).toHaveAttribute('href', 'https://github.com/octo/notes/pull/12');
  });

  it('counts a draft pull request as open', async () => {
    pulls = [pr('gonq/fix', 3, true)];
    const { user } = setup([{ branch: 'gonq/fix', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    expect(await screen.findByTestId('read-only-banner')).toHaveTextContent(MESSAGE(3));
  });

  it('refuses Ctrl+S with the same message and writes nothing; Commit… is greyed', async () => {
    pulls = [pr('gonq/fix', 12)];
    const { user } = setup([{ branch: 'gonq/fix', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    await screen.findByTestId('read-only-banner');
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGE(12));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(commits()).toHaveLength(0);
    expect(await commitItem(user)).toHaveAttribute('aria-disabled', 'true');
  });

  it('is editable when the check fails (offline)', async () => {
    pullsFail = true;
    const { user } = setup([{ branch: 'gonq/fix', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    await waitFor(() => expect(pullCalls().length).toBeGreaterThan(0));
    expect(banner()).toBeNull();
    expect(editorView().state.readOnly).toBe(false);
    type('!');
    expect(docText()).toBe('!# A\n');
    // The same paste event that read-only blocks goes through on an editable tab.
    const view = editorView();
    fireEvent(view.contentDOM, createEvent.paste(view.contentDOM, { clipboardData: { getData: () => 'PASTED', types: ['text/plain'] } } as unknown as EventInit));
    expect(docText()).toContain('PASTED');
  });

  it('becomes editable again when activated after the PR was closed', async () => {
    pulls = [pr('gonq/fix', 12)];
    const { user } = setup([
      { branch: 'gonq/fix', path: 'a.md', content: '# A\n' },
      { branch: 'main', path: 'b.md', content: '# B\n' },
    ]);
    await openRecent(user, /^a\.md/);
    await screen.findByTestId('read-only-banner');
    await openRecent(user, /^b\.md/, true);
    expect(banner()).toBeNull();
    pulls = [];
    await user.click(screen.getByRole('tab', { name: /a\.md/ }));
    await waitFor(() => expect(banner()).toBeNull());
    await settleEditors(document.body);
    expect(editorView().state.readOnly).toBe(false);
    type('!');
    expect(docText()).toBe('!# A\n');
  });

  it('flips every tab on the same branch after one check', async () => {
    pulls = [pr('gonq/fix', 5)];
    const { user } = setup([
      { branch: 'gonq/fix', path: 'a.md', content: '# A\n' },
      { branch: 'gonq/fix', path: 'b.md', content: '# B\n' },
    ]);
    await openRecent(user, /^a\.md/);
    await screen.findByTestId('read-only-banner');
    await openRecent(user, /^b\.md/, true);
    // b.md is read-only straight away from the shared state.
    expect(banner()).not.toBeNull();
    expect(editorView().state.readOnly).toBe(true);
  });
});

describe('Commit re-checks first', () => {
  it('refuses when a PR was opened meanwhile, writing nothing, and turns the tab read-only', async () => {
    const { user } = setup([{ branch: 'gonq/fix', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    type('!');
    pulls = [pr('gonq/fix', 9)];
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGE(9));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(commits()).toHaveLength(0);
    expect(await screen.findByTestId('read-only-banner')).toBeInTheDocument();
    expect(editorView().state.readOnly).toBe(true);
  });

  it('fails closed when the check cannot complete', async () => {
    const { user } = setup([{ branch: 'gonq/fix', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    type('!');
    pullsFail = true;
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check for an open pull request; try again.');
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(commits()).toHaveLength(0);
  });

  it('commits as before when there is no open PR', async () => {
    const { user } = setup([{ branch: 'gonq/fix', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    type('!');
    await user.keyboard('{Control>}s{/Control}');
    await screen.findByRole('dialog');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commits()).toHaveLength(1));
  });
});

describe('platform calls', () => {
  it('map each branch to its pull request or null, and ask once for many branches', async () => {
    pulls = [pr('a', 1), pr('c', 3, true)];
    const got = await openPullsForBranches('octo', 'notes', ['a', 'b', 'c']);
    expect(got.get('a')).toEqual({ number: 1, url: 'https://github.com/octo/notes/pull/1', draft: false });
    expect(got.get('b')).toBeNull();
    expect(got.get('c')).toMatchObject({ number: 3, draft: true });
    expect(pullCalls()).toHaveLength(1);
    expect(await openPullForBranch('octo', 'notes', 'b')).toBeNull();
  });

  it('reject with the network kind on a failed check', async () => {
    pullsFail = true;
    await expect(openPullForBranch('octo', 'notes', 'a')).rejects.toMatchObject({ kind: 'network' });
  });

  it('throw the desktop-app error on the web', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const err = await openPullForBranch('octo', 'notes', 'a').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err).toMatchObject({ kind: 'unavailable_on_web', message: 'Checking for open pull requests needs the Gonq desktop app' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
