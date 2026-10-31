/** Covers the mobile change-branch warning through renderMobileApp, porting the desktop branchChange.test.tsx: a clean GitHub document closes without a prompt, a dirty one asks "Change branch?" (Cancel focused, Close document destructive; Cancel changes nothing, Close document closes only that document), the same branch asks nothing, and no document means no prompt. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { settleEditors, select, type as typeText } from '@gonq/editor/testing/editor';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);

beforeEach(() => {
  invoke.mockReset();
  handlers = {
    github_status: () => ({ signed_in: true, login: 'octo', storage: 'keychain' }),
    github_list_repos: () => ({
      repos: [{ owner: 'o', name: 'r', full_name: 'o/r', private: false, default_branch: 'main', can_push: true, pushed_at: null }],
      next_page: null,
    }),
    github_list_branches: () => ({ default_branch: 'main', branches: ['main', 'dev', 'other'], next_page: null }),
    github_list_folder: () => ({ entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false }),
    github_read_file: (a) => ({ path: a.path, name: 'a.md', content: '# A\n', sha: 's', commit_sha: 'c' }),
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

/** Opens a.md (optionally edits it) and goes back to the repo tree. */
async function openDoc(user: User, dirty: boolean) {
  await user.click(screen.getByRole('button', { name: 'a.md' }));
  await screen.findByRole('switch', { name: 'Raw Markdown' });
  if (dirty) {
    settleEditors(document.body);
    select(0);
    typeText('X');
  }
  await user.click(screen.getByRole('button', { name: 'Back' }));
  await screen.findByRole('heading', { name: 'o/r' });
}

async function pickBranch(user: User, from: string, to: string) {
  await user.click(screen.getByRole('button', { name: `Branch: ${from}` }));
  await user.click(await screen.findByRole('option', { name: new RegExp(`${to}$`) }));
}

it('a clean active GitHub tab closes without a prompt and the navigator loads the new branch', async () => {
  const { user } = await openRepoTree();
  await openDoc(user, false);
  await pickBranch(user, 'main', 'dev');
  expect(await screen.findByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Change branch?' })).toBeNull();
  await waitFor(() => expect(calls('github_list_folder').slice(-1)[0][1]).toMatchObject({ branch: 'dev', path: '' }));
});

it('a dirty tab warns with the desktop wording; Cancel is focused and changes nothing', async () => {
  const { user } = await openRepoTree();
  await openDoc(user, true);
  await pickBranch(user, 'main', 'other');
  const d = await screen.findByRole('dialog', { name: 'Change branch?' });
  expect(d).toHaveTextContent('Changing branches will close a.md, and any uncommitted changes will be permanently lost.');
  expect(d).not.toHaveTextContent(/files?\b.*\d|\d.*files?/);
  expect(within(d).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  expect(within(d).getByRole('button', { name: 'Close document' })).toHaveClass('m-tap');
  await user.click(within(d).getByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Change branch?' })).toBeNull());
  expect(screen.getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
});

it('Close document closes the dirty document and moves the navigator', async () => {
  const { user } = await openRepoTree();
  await openDoc(user, true);
  await pickBranch(user, 'main', 'other');
  await user.click(await screen.findByRole('button', { name: 'Close document' }));
  expect(await screen.findByRole('button', { name: 'Branch: other' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('tab')).toBeNull();
});

it('choosing the branch the document is on asks nothing', async () => {
  const { user } = await openRepoTree();
  await openDoc(user, true);
  await pickBranch(user, 'main', 'main');
  expect(screen.queryByRole('dialog', { name: 'Change branch?' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Branch: main' })).toBeInTheDocument();
});

it('with no document open the branch change just reloads the navigator', async () => {
  const { user } = await openRepoTree();
  await pickBranch(user, 'main', 'dev');
  expect(await screen.findByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
});
