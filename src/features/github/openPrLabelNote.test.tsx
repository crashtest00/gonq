/** Open PR result screen: the PR link with no note, the non-blocking label note with the backend's reason, and no label field in the create invoke. */
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


async function createPr(user: User) {
  addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
  await openRepo(user);
  const d = await openPrDialog(user);
  await choose(user, d, 'gonq/one', 'main');
  await within(d).findByText(/2 commits ahead/);
  await user.click(within(d).getByRole('button', { name: 'Open PR' }));
  await user.click(within(d).getByRole('button', { name: 'Open PR' }));
  await within(d).findByText(/was opened for gonq\/one/);
  return d;
}

describe('Open PR label note', () => {
  it('shows only the link when the pull request was labelled', async () => {
    const { user } = renderApp();
    const d = await createPr(user);
    expect(within(d).getByRole('link', { name: '#12' })).toHaveAttribute('href', pullUrl(12));
    expect(within(d).queryByRole('note')).toBeNull();
    expect(within(d).queryByRole('alert')).toBeNull();
  });

  it('adds a non-blocking note with the reason, keeping the link and buttons', async () => {
    replies.github_create_pull = () => ({ number: 12, html_url: pullUrl(12), label_warning: 'Resource not accessible by integration' });
    const { user } = renderApp();
    const d = await createPr(user);
    expect(within(d).getByRole('note')).toHaveTextContent('Pull request created, but its label could not be added: Resource not accessible by integration');
    expect(within(d).queryByRole('alert')).toBeNull();
    expect(within(d).getByRole('link', { name: '#12' })).toHaveAttribute('href', pullUrl(12));
    expect(within(d).getByRole('button', { name: 'Open in browser' })).toBeEnabled();
    await user.click(within(d).getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('treats a null warning as none and sends no label argument', async () => {
    replies.github_create_pull = () => ({ number: 12, html_url: pullUrl(12), label_warning: null });
    const { user } = renderApp();
    const d = await createPr(user);
    expect(within(d).queryByRole('note')).toBeNull();
    const [[, args]] = calls('github_create_pull');
    expect(Object.keys(args as object).sort()).toEqual(['base', 'body', 'head', 'owner', 'repo', 'title']);
  });
});
