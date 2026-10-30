/** Navigator follows GitHub tabs, and a branch change closes the active GitHub document (warning when dirty); the no-tab message. */
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { settleEditors, type } from '../../testing/editor';
import { openGithub } from '../../platform/files';
import { renderApp, type User } from '../../testing/renderApp';
import { githubPath } from '../../platform/github';

let recentRows: { path: string; opened_at: number }[] = [];
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (cmd === 'recent_documents_list') return recentRows;
  if (cmd === 'recent_documents_add' || cmd === 'recent_documents_remove') return recentRows;
  if (cmd === 'take_launch_paths') return [];
  if (cmd === 'github_status') return { signed_in: true, login: 'me', storage: 'keychain' };
  if (cmd === 'github_list_branches') return { default_branch: 'main', branches: ['main', 'dev', 'other'], next_page: null };
  if (cmd === 'github_list_folder') return { entries: [], truncated: false };
  if (cmd === 'github_read_file')
    return { path: args!.path, name: 'a.md', content: `# ${args!.branch}\n\nbody of ${args!.branch}`, sha: 's', commit_sha: 'c' };
  return undefined;
});
vi.mock('../../platform/bindings', async () => (await import('../../testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));
vi.mock('../../platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('../../platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

const gh = (branch: string, repo = 'notes') => githubPath({ owner: 'octo', repo, branch, path: 'a.md' });

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invoke.mockClear();
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

function setup(rows: string[]) {
  recentRows = rows.map((path) => ({ path, opened_at: 1 }));
  return renderApp({ files: { openPath: openGithub } }).user;
}

async function openRecent(user: User, branch: string) {
  if (!screen.queryByRole('complementary', { name: 'Folder navigator' })) await user.click(screen.getByTitle('Folder navigator'));
  await user.click(await screen.findByRole('button', { name: new RegExp(`^a\\.md.*@ ${branch}`) }));
  await screen.findByText(`body of ${branch}`);
  await settleEditors(document.body);
}

async function pickBranch(user: User, from: string, to: string) {
  await user.click(screen.getByRole('button', { name: `Branch: ${from}` }));
  await user.click(await screen.findByRole('option', { name: to }));
}

describe('branch change with a GitHub document', () => {
  it('a clean active GitHub tab closes without a prompt, selects no tab, and the navigator loads the new branch', async () => {
    const user = setup([gh('main')]);
    await openRecent(user, 'main');
    await pickBranch(user, 'main', 'dev');
    expect(await screen.findByText('Open a document or create a new one.')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryAllByRole('tab')).toHaveLength(0);
    expect(await screen.findByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith('github_list_folder', { owner: 'octo', repo: 'notes', branch: 'dev', path: '' }),
    );
  });

  async function dirtyMainTab() {
    const user = setup([gh('main'), gh('dev')]);
    await openRecent(user, 'main');
    await openRecent(user, 'dev');
    await user.click(screen.getByRole('tab', { name: /a\.md/, selected: false }));
    expect(screen.getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
    type('X');
    expect(await screen.findByLabelText('unsaved changes')).toBeInTheDocument();
    await pickBranch(user, 'main', 'other');
    expect(await screen.findByRole('dialog')).toHaveTextContent(/uncommitted changes will be permanently lost/);
    return user;
  }

  it('a dirty tab warns; Cancel changes nothing', async () => {
    const user = await dirtyMainTab();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
  });

  it('a dirty tab warns; Close document closes only that document', async () => {
    const user = await dirtyMainTab();
    await user.click(screen.getByRole('button', { name: 'Close document' }));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    expect(screen.queryAllByRole('tab', { selected: true })).toHaveLength(0);
    expect(await screen.findByText('Open a document or create a new one.')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Branch: other' })).toBeInTheDocument();

    // The remaining tab can be activated and moves the navigator back to its branch.
    await user.click(screen.getByRole('tab', { name: /a\.md/ }));
    await screen.findByText('body of dev');
    expect(await screen.findByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
  });

  it('choosing the branch the tab is on closes nothing', async () => {
    const user = setup([gh('main')]);
    await openRecent(user, 'main');
    await user.click(screen.getByRole('button', { name: 'Branch: main' }));
    await user.click(await screen.findByRole('option', { name: 'main' }));
    expect(screen.getAllByRole('tab')).toHaveLength(1);
  });

  it('with no tab selected the branch change just reloads the navigator', async () => {
    const user = setup([gh('main')]);
    await openRecent(user, 'main');
    await pickBranch(user, 'main', 'dev');
    await pickBranch(user, 'dev', 'other');
    expect(await screen.findByRole('button', { name: 'Branch: other' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('the navigator follows GitHub tabs', () => {
  it('activating a tab from another repo and branch moves the navigator, even after an explicit repo choice', async () => {
    const user = setup([gh('main'), gh('dev', 'other-repo')]);
    await openRecent(user, 'main');
    await openRecent(user, 'dev');
    expect(screen.getByText('octo/other-repo')).toBeInTheDocument();
    await user.click(screen.getAllByRole('tab')[0]);
    expect(await screen.findByText('octo/notes')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
    await user.click(screen.getAllByRole('tab')[1]);
    expect(await screen.findByText('octo/other-repo')).toBeInTheDocument();
    expect(await screen.findByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
  });
});

it('shows the generic message with no tab', async () => {
  setup([]);
  expect(await screen.findByText('Open a document or create a new one.')).toBeInTheDocument();
});
