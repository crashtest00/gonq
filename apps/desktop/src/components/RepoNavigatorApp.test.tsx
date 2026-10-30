/** The repo navigator in the app: File > Open Repo… opens it on the default branch; web build and file clicks. */
import { cleanup, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { menu, renderApp } from '../testing/renderApp';

vi.mock('../platform/lifecycle', () => ({ guardClose: () => () => {} }));
const invoke = vi.fn();
vi.mock('../platform/bindings', async () => (await import('../testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));

const repo = { owner: 'octo', name: 'notes', full_name: 'octo/notes', private: false, default_branch: 'trunk', can_push: true, pushed_at: null };

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  const handlers: Record<string, (a: Record<string, unknown>) => unknown> = {
    github_status: () => ({ signed_in: true, login: 'octo', storage: 'keychain' }),
    github_list_repos: () => ({ repos: [repo], next_page: null }),
    github_list_branches: () => ({ default_branch: 'trunk', branches: ['trunk', 'dev'], next_page: null }),
    github_list_folder: () => ({ entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false }),
  };
  invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => {
    const h = handlers[cmd];
    if (!h) throw new Error(`unmocked ${cmd}`);
    return h(args);
  });
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

it('choosing a repository opens the navigator on its default branch and clicking a file opens nothing yet', async () => {
  const { user, pickDocument } = renderApp();
  await menu(user, 'File', 'Open Repo…');
  await user.click(await screen.findByRole('button', { name: /octo\/notes/ }));
  expect(await screen.findByRole('complementary', { name: 'Folder navigator' })).toBeInTheDocument();
  expect(screen.getByText('octo/notes')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Branch: trunk' })).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith('github_list_folder', { owner: 'octo', repo: 'notes', branch: 'trunk', path: '' });
  await user.click(await screen.findByText('a.md'));
  expect(pickDocument).not.toHaveBeenCalled();
  expect(screen.queryByRole('alert')).toBeNull();
});
