/** Commit on GitHub tabs: the confirm dialog (content, warning, keys), the commit call and its result handling (success, conflict, error, no changes, double Ctrl+S), local tabs still saving, and the web error. */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { menu, renderApp, openDocument, testDoc } from '../../testing/renderApp';
import { settleEditors, type } from '../../testing/editor';
import { openGithub, type FileAccess } from '../../platform/files';
import { commitFile, githubPath, GitHubError } from '../../platform/github';
import { clearSessionBranches, listSessionBranches } from './sessionBranches';

let recentRows: { path: string; opened_at: number }[] = [];
const reads: Record<string, unknown> = {};
let commitReply: () => unknown = () => ({ status: 'committed', sha: 'blob2', commit_sha: 'tip2' });
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (cmd === 'recent_documents_list') return recentRows;
  if (cmd === 'recent_documents_add') return recentRows;
  if (cmd === 'recent_documents_remove') return recentRows;
  if (cmd === 'take_launch_paths') return [];
  if (cmd === 'github_status') return { signed_in: true, login: 'me', storage: 'keychain' };
  if (cmd === 'github_list_branches') return { default_branch: 'main', branches: ['main'], next_page: null };
  if (cmd === 'github_list_folder') return { entries: [], truncated: false };
  if (cmd === 'github_read_file') return reads[`${args!.branch}:${args!.path}`];
  if (cmd === 'github_commit_file') return commitReply();
  return undefined;
});
vi.mock('../../platform/bindings', async () => (await import('../../testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));
vi.mock('../../platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('../../platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

const loc = { owner: 'octo', repo: 'notes' };
const file = (path: string, content: string, sha = 'blob1') => ({ path, name: path.split('/').pop(), content, sha, commit_sha: 'tip1' });
const commits = () => invoke.mock.calls.filter((c) => c[0] === 'github_commit_file');

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  recentRows = [];
  for (const k of Object.keys(reads)) delete reads[k];
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
  const saveDocument = vi.fn(async (d: { name: string; path: string | null }) => ({ name: d.name, path: d.path }));
  const files: FileAccess = { pickDocument: async () => null, saveDocument, saveDocumentAs: async () => null, openPath: openGithub };
  const user = userEvent.setup();
  render(<App files={files} />);
  return { user, saveDocument };
}

async function openRecent(user: ReturnType<typeof userEvent.setup>, name: RegExp) {
  await user.click(screen.getByTitle('Folder navigator'));
  await user.click(await screen.findByRole('button', { name }));
  await settleEditors(document.body);
}

/** Opens the file, appends a line in the editor and returns the dialog opened by Ctrl+S. */
async function editAndCommit(user: ReturnType<typeof userEvent.setup>, name: RegExp, extra = '!') {
  await openRecent(user, name);
  type(extra);
  await user.keyboard('{Control>}s{/Control}');
  return screen.findByRole('dialog');
}

describe('commit dialog', () => {
  it('shows file, repository, branch and the fixed message; a gonq/ branch has no warning', async () => {
    const { user } = setup([{ branch: 'gonq/fix', path: 'docs/a.md', content: '# A\n' }]);
    const dialog = await editAndCommit(user, /^a\.md/);
    expect(within(dialog).getAllByText('docs/a.md').length).toBeGreaterThan(0);
    expect(within(dialog).getByText('octo/notes')).toBeInTheDocument();
    expect(within(dialog).getByText('gonq/fix')).toBeInTheDocument();
    expect(within(dialog).getByText('Edit docs/a.md from Gonq')).toBeInTheDocument();
    expect(within(dialog).queryByRole('note')).toBeNull();
  });

  it('warns on a branch that does not start with gonq/', async () => {
    const { user } = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    const dialog = await editAndCommit(user, /^a\.md/);
    const note = within(dialog).getByRole('note');
    expect(note).toHaveTextContent('commits directly to main');
    expect(note).toHaveTextContent('Branch protection and review rules are GitHub');
    expect(note).toHaveTextContent('Gonq does not check them');
  });

  it('focuses Commit, Enter commits and marks the tab clean with the new shas', async () => {
    const { user } = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    const dialog = await editAndCommit(user, /^a\.md/);
    expect(within(dialog).getByRole('button', { name: 'Commit' })).toHaveFocus();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commits()).toHaveLength(1));
    expect(commits()[0][1]).toEqual({ owner: 'octo', repo: 'notes', branch: 'main', path: 'a.md', text: '!# A\n', sha: 'blob1' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(listSessionBranches()).toEqual([{ ...loc, branch: 'main' }]);
    // The tab is clean now, with blob2 recorded: another Ctrl+S has nothing to commit.
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('No changes to commit')).toBeInTheDocument();
    expect(commits()).toHaveLength(1);
    type('?');
    await user.keyboard('{Control>}s{/Control}');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commits()).toHaveLength(2));
    expect(commits()[1][1]).toMatchObject({ sha: 'blob2' });
  });

  it('puts Cancel one Tab away and Esc cancels without calling anything', async () => {
    const { user } = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    const dialog = await editAndCommit(user, /^a\.md/);
    await user.tab();
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(commits()).toHaveLength(0);
    expect(listSessionBranches()).toEqual([]);
  });

  it('File > Commit… opens the same dialog', async () => {
    const { user } = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    type('!');
    await menu(user, 'File', /^Commit…/);
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});

describe('commit results', () => {
  it('sends an edited CRLF file with CRLF throughout', async () => {
    const { user } = setup([{ branch: 'main', path: 'a.md', content: 'one\r\ntwo\r\n' }]);
    await editAndCommit(user, /^a\.md/, 'x');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commits()).toHaveLength(1));
    expect((commits()[0][1] as { text: string }).text).toBe('xone\r\ntwo\r\n');
  });

  it('says there is nothing to commit and calls nothing on an unchanged document', async () => {
    const { user } = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    await user.keyboard('{Control>}s{/Control}');
    expect(await screen.findByText('No changes to commit')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(commits()).toHaveLength(0);
  });

  it('opens the ConflictDialog on a conflict and records nothing', async () => {
    commitReply = () => ({ status: 'conflict' });
    const { user } = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await editAndCommit(user, /^a\.md/);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('a.md changed on the server since you opened it.')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(listSessionBranches()).toEqual([]);
    // Still unsaved: Ctrl+S asks again, with the old sha.
    await user.keyboard('{Control>}s{/Control}');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(commits()).toHaveLength(2));
    expect(commits()[1][1]).toMatchObject({ sha: 'blob1' });
  });

  it("puts GitHub's message as given in the error banner", async () => {
    commitReply = () => {
      throw { kind: 'http', status: 422, message: 'Required status check is expected.' };
    };
    const { user } = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await editAndCommit(user, /^a\.md/);
    await user.keyboard('{Enter}');
    expect(await screen.findByText('Required status check is expected.')).toBeInTheDocument();
    expect(listSessionBranches()).toEqual([]);
  });

  it('commits once when Ctrl+S is pressed twice quickly or Enter twice', async () => {
    const { user } = setup([{ branch: 'main', path: 'a.md', content: '# A\n' }]);
    await openRecent(user, /^a\.md/);
    type('!');
    await user.keyboard('{Control>}s{/Control}{Control>}s{/Control}');
    await screen.findByRole('dialog');
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    await user.keyboard('{Enter}{Enter}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(commits()).toHaveLength(1);
  });

  it('commits two tabs on the same branch in turn, and one file on two branches to each branch', async () => {
    const { user } = setup([
      { branch: 'gonq/x', path: 'a.md', content: 'A\n' },
      { branch: 'gonq/x', path: 'b.md', content: 'B\n' },
      { branch: 'gonq/y', path: 'a.md', content: 'A\n' },
    ]);
    await openRecent(user, /^a\.md.*@ gonq\/x/);
    await user.click(screen.getByRole('button', { name: /^b\.md.*@ gonq\/x/ }));
    await user.click(await screen.findByRole('button', { name: /^a\.md.*@ gonq\/y/ }));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(3));
    await settleEditors(document.body);
    // Commit each tab in turn, from the active one.
    for (const tab of [/a\.md \(gonq\/x\)/, /b\.md/, /a\.md \(gonq\/y\)/]) {
      await user.click(screen.getByRole('tab', { name: tab }));
      await settleEditors(document.body);
      type('+');
      await user.keyboard('{Control>}s{/Control}');
      await screen.findByRole('dialog');
      await user.keyboard('{Enter}');
      await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    }
    expect(commits().map((c) => (c[1] as { branch: string; path: string }).branch + ':' + (c[1] as { path: string }).path)).toEqual([
      'gonq/x:a.md',
      'gonq/x:b.md',
      'gonq/y:a.md',
    ]);
    expect(listSessionBranches()).toEqual([
      { ...loc, branch: 'gonq/x' },
      { ...loc, branch: 'gonq/y' },
    ]);
  }, 30000);
});

describe('other tabs and the web', () => {
  it('a local tab still saves with Save', async () => {
    const { user, saveDocument } = renderApp({ docs: testDoc('# L\n') });
    await openDocument(user);
    await settleEditors(document.body);
    type('!');
    await user.keyboard('{Control>}s{/Control}');
    await waitFor(() => expect(saveDocument).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('the Commit… item is in the File menu on the web and is off without a GitHub tab', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const { user } = renderApp({ docs: testDoc('# L\n') });
    await openDocument(user);
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    expect(await screen.findByRole('menuitem', { name: /^Commit…/ })).toHaveAttribute('aria-disabled', 'true');
  });

  it('File menu lists Save, Save As…, Commit… in that order', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const { user } = renderApp({ docs: testDoc('# L\n') });
    await openDocument(user);
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    await screen.findByRole('menuitem', { name: /^Commit…/ });
    const names = screen.getAllByRole('menuitem').map((e) => e.textContent ?? '');
    const at = (re: RegExp) => names.findIndex((n) => re.test(n));
    expect(at(/^Save As…/)).toBe(at(/^Save(?! As)/) + 1);
    expect(at(/^Commit…/)).toBe(at(/^Save As…/) + 1);
  });

  it('commitFile throws the clear desktop-app error on the web', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const err = await commitFile({ ...loc, branch: 'main', path: 'a.md', text: 'x', sha: 's' }).catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.kind).toBe('unavailable_on_web');
    expect(err.message).toBe('Committing to GitHub needs the Gonq desktop app');
  });
});
