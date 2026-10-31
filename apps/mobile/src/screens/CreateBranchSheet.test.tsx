/** Covers the mobile Create branch sheet through renderMobileApp, porting the desktop createBranch.test.tsx and createBranchName.test.ts: fixed gonq/ prefix, live reasons, advisory and authoritative "already exists", one request for a double tap, branch-only (the navigator stays), branch-and-commit (conflict check first, partial failure with Close, navigator moves only when committed), the busy state and the web error. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { settleEditors, select, type as typeText } from '@gonq/editor/testing/editor';
import { clearSessionBranches, listSessionBranches } from '@gonq/editor/features/github/sessionBranches';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);
const loc = { owner: 'o', repo: 'r' };
let remote = { content: '# A\n', sha: 'blob1' };

beforeEach(() => {
  invoke.mockReset();
  clearSessionBranches();
  remote = { content: '# A\n', sha: 'blob1' };
  handlers = {
    github_status: () => ({ signed_in: true, login: 'octo', storage: 'keychain' }),
    github_list_repos: () => ({
      repos: [{ owner: 'o', name: 'r', full_name: 'o/r', private: false, default_branch: 'main', can_push: true, pushed_at: null }],
      next_page: null,
    }),
    github_list_branches: () => ({ default_branch: 'main', branches: ['main', 'dev'], next_page: null }),
    github_list_folder: () => ({ entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false }),
    github_read_file: (a) => ({ path: a.path, name: 'a.md', content: remote.content, sha: remote.sha, commit_sha: 'tip1' }),
    github_branch_exists: () => false,
    github_create_branch: () => undefined,
    github_commit_file: () => ({ status: 'committed', sha: 'blob2', commit_sha: 'tip2' }),
    recent_documents_list: () => [],
    recent_documents_add: () => [],
  };
  invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => handlers[cmd]?.(args ?? {}));
});

async function openRepoTree() {
  const r = await renderMobileApp();
  await r.user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await r.user.click(await screen.findByRole('button', { name: /o\/r/ }));
  await screen.findByRole('heading', { name: 'o/r' });
  await screen.findByRole('button', { name: 'a.md' });
  return r;
}

/** Opens a.md, edits it (dirty) and goes back to the repo tree. */
async function dirtyTab(user: User) {
  await user.click(screen.getByRole('button', { name: 'a.md' }));
  await screen.findByRole('switch', { name: 'Raw Markdown' });
  settleEditors(document.body);
  select(0);
  typeText('!');
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await screen.findByRole('heading', { name: 'o/r' });
}

async function openSheet(user: User) {
  await user.click(screen.getByRole('button', { name: 'Create branch' }));
  return screen.findByRole('dialog', { name: 'Create branch' });
}
const nameBox = (d: HTMLElement) => within(d).getByRole('textbox', { name: 'Branch name' });
const createBtn = (d: HTMLElement) => within(d).getByRole('button', { name: 'Create' });

it('opens from the repo screen with a fixed gonq/ prefix, "From <branch>" and Cancel / Create', async () => {
  const { user } = await openRepoTree();
  const d = await openSheet(user);
  expect(within(d).getByTestId('branch-prefix')).toHaveTextContent('gonq/');
  expect(within(d).getAllByRole('textbox')).toHaveLength(1);
  expect(within(d).getByText('From main')).toBeInTheDocument();
  expect(within(d).getByRole('button', { name: 'Cancel' })).toHaveClass('m-tap');
  expect(createBtn(d)).toHaveClass('m-tap');
  expect(within(d).queryByText(/Letters, numbers/)).toBeNull();
  await user.click(within(d).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('Create is inactive while empty or invalid, with the desktop reason beside the field', async () => {
  const { user } = await openRepoTree();
  const d = await openSheet(user);
  expect(createBtn(d)).toBeDisabled();
  expect(within(d).queryByText('Enter a name')).toBeNull();
  const cases: [string, string][] = [
    ['a b', 'No spaces'],
    ['a..b', 'No “..”'],
    ['a@{b', 'No “@{”'],
    ['@', 'Not just “@”'],
    ['a~b', 'No “~”'],
    ['/a', 'Cannot start or end with “/”'],
    ['a.', 'Cannot start or end with “.”'],
    ['a//b', 'No “//”'],
    ['a.lock', 'A part cannot end with “.lock”'],
    ['a/.b/c', 'A part cannot start with “.”'],
  ];
  for (const [value, reason] of cases) {
    await user.clear(nameBox(d));
    await user.type(nameBox(d), value.replace(/[{[]/g, '$&$&'));
    expect(within(d).getByText(reason)).toBeInTheDocument();
    expect(createBtn(d)).toBeDisabled();
  }
  await user.clear(nameBox(d));
  await user.type(nameBox(d), 'ok/name');
  expect(createBtn(d)).toBeEnabled();
  await user.clear(nameBox(d));
  await user.type(nameBox(d), 'ブランチ' + 'x'.repeat(200));
  expect(createBtn(d)).toBeEnabled();
});

it('shows the advisory collision before the tap, and Create stays inactive', async () => {
  handlers.github_branch_exists = (a) => a.name === 'taken';
  const { user } = await openRepoTree();
  const d = await openSheet(user);
  await user.type(nameBox(d), 'taken');
  expect(await within(d).findByText('That branch already exists')).toBeInTheDocument();
  expect(createBtn(d)).toBeDisabled();
  expect(calls('github_create_branch')).toHaveLength(0);
  expect(calls('github_branch_exists').slice(-1)[0][1]).toEqual({ ...loc, name: 'taken' });
});

it("the create call's 'already exists' error shows the same message and keeps the sheet", async () => {
  handlers.github_create_branch = () => {
    throw { kind: 'already_exists' };
  };
  const { user } = await openRepoTree();
  const d = await openSheet(user);
  await user.type(nameBox(d), 'race');
  await user.click(createBtn(d));
  expect(await within(d).findByText('That branch already exists')).toBeInTheDocument();
  expect(listSessionBranches()).toEqual([]);
});

it('two quick taps create once, and Create is disabled while the request is in flight', async () => {
  let release: () => void = () => {};
  handlers.github_create_branch = () => new Promise<void>((r) => (release = r));
  const { user } = await openRepoTree();
  const d = await openSheet(user);
  await user.type(nameBox(d), 'once');
  await user.dblClick(createBtn(d));
  expect(createBtn(d)).toBeDisabled();
  release();
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls('github_create_branch')).toHaveLength(1);
});

it('on the web the platform error is shown and nothing is hidden', async () => {
  const { user } = await openRepoTree();
  const d = await openSheet(user);
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  try {
    await user.type(nameBox(d), 'web');
    await user.click(createBtn(d));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Creating a GitHub branch needs the Gonq app');
  } finally {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  }
});

it('a clean state: creates gonq/<name> from the navigator branch, nothing moves, and the branch joins the branch sheet', async () => {
  const { user } = await openRepoTree();
  const d = await openSheet(user);
  expect(within(d).queryByText(/will also commit/)).toBeNull();
  await user.type(nameBox(d), 'new/one');
  await user.click(createBtn(d));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  expect(calls('github_create_branch')[0][1]).toEqual({ ...loc, source: 'main', name: 'new/one' });
  expect(calls('github_commit_file')).toHaveLength(0);
  expect(listSessionBranches()).toEqual([{ ...loc, branch: 'gonq/new/one' }]);
  await user.click(screen.getByRole('button', { name: 'Branch: main' }));
  expect(await screen.findByRole('option', { name: /gonq\/new\/one/ })).toBeInTheDocument();
});

it('a dirty GitHub tab: says it will commit, checks the file first, commits, and the navigator moves to the new branch', async () => {
  const { user } = await openRepoTree();
  await dirtyTab(user);
  const d = await openSheet(user);
  expect(within(d).getByText('Creating this branch will also commit your changes in a.md to it.')).toBeInTheDocument();
  await user.type(nameBox(d), 'save');
  await user.click(createBtn(d));
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  const order = invoke.mock.calls.map((c) => c[0]).filter((c) => ['github_read_file', 'github_create_branch', 'github_commit_file'].includes(c as string));
  expect(order.slice(-3)).toEqual(['github_read_file', 'github_create_branch', 'github_commit_file']);
  expect(calls('github_commit_file')[0][1]).toEqual({ ...loc, branch: 'gonq/save', path: 'a.md', text: '!# A\n', sha: 'blob1' });
  expect(await screen.findByRole('button', { name: 'Branch: gonq/save' })).toBeInTheDocument();
  expect(listSessionBranches()).toEqual([{ ...loc, branch: 'gonq/save' }]);
});

it('a file changed on GitHub creates nothing and says so', async () => {
  const { user } = await openRepoTree();
  await dirtyTab(user);
  remote = { content: '# changed\n', sha: 'other' };
  const d = await openSheet(user);
  await user.type(nameBox(d), 'nope');
  await user.click(createBtn(d));
  expect(await within(d).findByRole('alert')).toHaveTextContent(
    'a.md changed on GitHub since you opened it, so no branch was created. Nothing was committed.',
  );
  expect(calls('github_create_branch')).toHaveLength(0);
  expect(calls('github_commit_file')).toHaveLength(0);
  expect(listSessionBranches()).toEqual([]);
  expect(within(d).getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

it('a commit failing after creation names the branch and the step, keeps the branch, leaves the navigator, and the button reads Close', async () => {
  handlers.github_commit_file = () => {
    throw { kind: 'http', message: 'Resource not accessible' };
  };
  const { user } = await openRepoTree();
  await dirtyTab(user);
  const d = await openSheet(user);
  await user.type(nameBox(d), 'half');
  await user.click(createBtn(d));
  const alert = await within(d).findByRole('alert');
  expect(alert).toHaveTextContent('The branch gonq/half was created, but committing a.md to it failed:');
  expect(alert).toHaveTextContent('The branch was left in place.');
  expect(listSessionBranches()).toEqual([{ ...loc, branch: 'gonq/half' }]);
  expect(createBtn(d)).toBeDisabled();
  expect(within(d).queryByRole('button', { name: 'Cancel' })).toBeNull();
  await user.click(within(d).getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
});
