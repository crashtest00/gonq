/** Create branch: navigator icon and dialog (prefix, validation, advisory and authoritative "already exists", double click), branch-only, branch-and-commit (conflict check first, partial failure), the Commit dialog's 'Commit to new branch…' button, and the web error. */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { settleEditors, type } from '../../testing/editor';
import { openGithub, type FileAccess } from '../../platform/files';
import { githubPath } from '../../platform/github';
import { clearSessionBranches, listSessionBranches } from './sessionBranches';

let recentRows: { path: string; opened_at: number }[] = [];
const reads: Record<string, unknown> = {};
let existsReply: (name: string) => boolean = () => false;
let createReply: () => unknown = () => undefined;
let commitReply: () => unknown = () => ({ status: 'committed', sha: 'blob2', commit_sha: 'tip2' });
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (cmd === 'recent_documents_list' || cmd === 'recent_documents_add' || cmd === 'recent_documents_remove') return recentRows;
  if (cmd === 'take_launch_paths') return [];
  if (cmd === 'github_status') return { signed_in: true, login: 'me', storage: 'keychain' };
  if (cmd === 'github_list_branches') return { default_branch: 'main', branches: ['main', 'dev'], next_page: null };
  if (cmd === 'github_list_folder') return { entries: [], truncated: false };
  if (cmd === 'github_read_file') return reads[`${args!.branch}:${args!.path}`];
  if (cmd === 'github_branch_exists') return existsReply(String(args!.name));
  if (cmd === 'github_create_branch') return createReply();
  if (cmd === 'github_commit_file') return commitReply();
  return undefined;
});
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: [string, Record<string, unknown>?]) => invoke(...a) }));
vi.mock('../../platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('../../platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

const loc = { owner: 'octo', repo: 'notes' };
const file = (path: string, content: string, sha = 'blob1') => ({ path, name: path.split('/').pop(), content, sha, commit_sha: 'tip1' });
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  recentRows = [];
  for (const k of Object.keys(reads)) delete reads[k];
  existsReply = () => false;
  createReply = () => undefined;
  commitReply = () => ({ status: 'committed', sha: 'blob2', commit_sha: 'tip2' });
  invoke.mockClear();
  clearSessionBranches();
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

function setup(rows: { branch: string; path: string; content: string }[]) {
  recentRows = rows.map((r, i) => {
    reads[`${r.branch}:${r.path}`] = file(r.path, r.content);
    return { path: githubPath({ ...loc, branch: r.branch, path: r.path }), opened_at: 10 - i };
  });
  const files: FileAccess = { pickDocument: async () => null, saveDocument: async (d) => ({ name: d.name, path: d.path }), saveDocumentAs: async () => null, openPath: openGithub };
  const user = userEvent.setup();
  render(<App files={files} />);
  return user;
}

type U = ReturnType<typeof userEvent.setup>;

async function openRecent(user: U, name: RegExp) {
  await user.click(screen.getByTitle('Folder navigator'));
  await user.click(await screen.findByRole('button', { name }));
  await settleEditors(document.body);
}

async function openDialog(user: U) {
  await user.click(screen.getByRole('button', { name: 'Create branch' }));
  return screen.findByRole('dialog');
}

const nameBox = (d: HTMLElement) => within(d).getByRole('textbox', { name: 'Branch name' });
const createBtn = (d: HTMLElement) => within(d).getByRole('button', { name: 'Create' });

describe('create branch dialog', () => {
  it('the icon opens it; the gonq/ prefix is fixed text, not an editable field', async () => {
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    const d = await openDialog(user);
    expect(within(d).getByTestId('branch-prefix')).toHaveTextContent('gonq/');
    expect(within(d).getAllByRole('textbox')).toHaveLength(1);
    await user.type(nameBox(d), 'x');
    expect(nameBox(d)).toHaveValue('x');
  });

  it('Create is inactive while empty or invalid, with the reason beside the field', async () => {
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    const d = await openDialog(user);
    expect(createBtn(d)).toBeDisabled();
    await user.type(nameBox(d), 'a b');
    expect(createBtn(d)).toBeDisabled();
    expect(within(d).getByText('No spaces')).toBeInTheDocument();
    await user.clear(nameBox(d));
    await user.type(nameBox(d), 'ok/name');
    expect(createBtn(d)).toBeEnabled();
  });

  it('long and unicode names are accepted without breaking the form', async () => {
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    const d = await openDialog(user);
    await user.type(nameBox(d), 'ブランチ' + 'x'.repeat(200));
    expect(createBtn(d)).toBeEnabled();
  });

  it('shows the advisory collision before the click, and Create stays inactive', async () => {
    existsReply = (n) => n === 'taken';
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    const d = await openDialog(user);
    await user.type(nameBox(d), 'taken');
    expect(await within(d).findByText('That branch already exists')).toBeInTheDocument();
    expect(createBtn(d)).toBeDisabled();
    expect(calls('github_create_branch')).toHaveLength(0);
    expect((calls('github_branch_exists').slice(-1)[0])[1]).toEqual({ ...loc, name: 'taken' });
  });

  it("the create call's 'already exists' error shows the same message", async () => {
    createReply = () => {
      throw { kind: 'already_exists' };
    };
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    const d = await openDialog(user);
    await user.type(nameBox(d), 'race');
    await user.click(createBtn(d));
    expect(await within(d).findByText('That branch already exists')).toBeInTheDocument();
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    expect(listSessionBranches()).toEqual([]);
  });

  it('two quick clicks create once', async () => {
    let release: () => void = () => {};
    createReply = () => new Promise<void>((r) => (release = r)) as unknown;
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    const d = await openDialog(user);
    await user.type(nameBox(d), 'once');
    await user.dblClick(createBtn(d));
    release();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('github_create_branch')).toHaveLength(1);
  });

  it('on the web the platform error is shown and nothing is hidden', async () => {
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    const d = await openDialog(user);
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await user.type(nameBox(d), 'web');
    await user.click(createBtn(d));
    expect(await within(d).findByRole('alert')).toHaveTextContent('Creating a GitHub branch needs the Gonq desktop app');
  });
});

describe('branch only', () => {
  it('a clean tab: creates from the tab branch, nothing moves, the branch joins the dropdown and session list', async () => {
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    const d = await openDialog(user);
    expect(within(d).queryByText(/will also commit/)).toBeNull();
    await user.type(nameBox(d), 'new/one');
    await user.click(createBtn(d));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('github_create_branch')[0][1]).toEqual({ ...loc, source: 'main', name: 'new/one' });
    expect(calls('github_commit_file')).toHaveLength(0);
    expect(listSessionBranches()).toEqual([{ ...loc, branch: 'gonq/new/one' }]);
    // The navigator stays on main and the tab stays open.
    const menuButton = screen.getByRole('button', { name: 'Branch: main' });
    expect(screen.getAllByText('a.md').length).toBeGreaterThan(0);
    await user.click(menuButton);
    expect(await screen.findByRole('option', { name: /gonq\/new\/one/ })).toBeInTheDocument();
  });

  it('with no tab open it only creates the branch', async () => {
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    await user.keyboard('{Control>}w{/Control}');
    const d = await openDialog(user);
    await user.type(nameBox(d), 'solo');
    await user.click(createBtn(d));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('github_create_branch')[0][1]).toMatchObject({ source: 'main', name: 'solo' });
    expect(screen.getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
  });
});

describe('branch and commit', () => {
  async function dirty(user: U) {
    await openRecent(user, /^a\.md/);
    type('!');
  }

  it('commits the active dirty tab to the new branch, updates it and the navigator', async () => {
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await dirty(user);
    const d = await openDialog(user);
    expect(within(d).getByText('Creating this branch will also commit your changes in a.md to it.')).toBeInTheDocument();
    await user.type(nameBox(d), 'save');
    await user.click(createBtn(d));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    const order = invoke.mock.calls.map((c) => c[0]).filter((c) => ['github_read_file', 'github_create_branch', 'github_commit_file'].includes(c as string));
    expect(order.slice(-3)).toEqual(['github_read_file', 'github_create_branch', 'github_commit_file']);
    expect(calls('github_commit_file')[0][1]).toEqual({ ...loc, branch: 'gonq/save', path: 'a.md', text: '!# A\n', sha: 'blob1' });
    expect(await screen.findByRole('button', { name: 'Branch: gonq/save' })).toBeInTheDocument();
    expect(listSessionBranches()).toEqual([{ ...loc, branch: 'gonq/save' }]);
    // Clean now: Ctrl+S has nothing to commit.
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('No changes to commit')).toBeInTheDocument();
  });

  it('a changed file on GitHub creates nothing', async () => {
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await dirty(user);
    reads['main:a.md'] = file('a.md', '# changed\n', 'other');
    const d = await openDialog(user);
    await user.type(nameBox(d), 'nope');
    await user.click(createBtn(d));
    expect(await within(d).findByRole('alert')).toHaveTextContent('no branch was created');
    expect(calls('github_create_branch')).toHaveLength(0);
    expect(calls('github_commit_file')).toHaveLength(0);
    expect(listSessionBranches()).toEqual([]);
  });

  it('a commit failing after creation names the branch and the step, and keeps the branch', async () => {
    commitReply = () => {
      throw { kind: 'http', message: 'Resource not accessible' };
    };
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await dirty(user);
    const d = await openDialog(user);
    await user.type(nameBox(d), 'half');
    await user.click(createBtn(d));
    const alert = await within(d).findByRole('alert');
    expect(alert).toHaveTextContent('gonq/half');
    expect(alert).toHaveTextContent('committing a.md');
    expect(alert).toHaveTextContent('left in place');
    expect(listSessionBranches()).toEqual([{ ...loc, branch: 'gonq/half' }]);
    expect(createBtn(d)).toBeDisabled();
  });

  it('only the active tab is committed', async () => {
    const user = setup([
      { branch: 'main', path: 'a.md', content: '# A\n' },
      { branch: 'main', path: 'b.md', content: '# B\n' },
    ]);
    await openRecent(user, /^a\.md/);
    type('!');
    await user.click(await screen.findByRole('button', { name: /^b\.md/ }));
    await settleEditors(document.body);
    type('?');
    const d = await openDialog(user);
    await user.type(nameBox(d), 'two');
    await user.click(createBtn(d));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('github_commit_file')).toHaveLength(1);
    expect(calls('github_commit_file')[0][1]).toMatchObject({ path: 'b.md' });
  });
});

describe('Commit to new branch… button', () => {
  async function commitDialog(user: U) {
    await openRecent(user, /^a\.md/);
    type('!');
    await user.keyboard('{Control>}s{/Control}');
    return screen.findByRole('dialog');
  }

  it('is shown on a non-gonq/ branch and opens branch-and-commit', async () => {
    const user = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    const d = await commitDialog(user);
    await user.click(within(d).getByRole('button', { name: 'Commit to new branch…' }));
    const create = await screen.findByRole('dialog', { name: 'Create branch' });
    expect(within(create).getByText(/will also commit your changes in a.md/)).toBeInTheDocument();
    await user.type(nameBox(create), 'viabutton');
    await user.click(createBtn(create));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(calls('github_commit_file')[0][1]).toMatchObject({ branch: 'gonq/viabutton' });
  });

  it('is absent on a gonq/ branch', async () => {
    const user = setup([{ branch: 'gonq/x', path: 'a.md', content: '# A\n' }]);
    const d = await commitDialog(user);
    expect(within(d).queryByRole('button', { name: 'Commit to new branch…' })).toBeNull();
  });
});
