/** Covers the Comments sheet on a read-only tab (a GitHub branch with an open pull request) through renderMobileApp: Add comment stays shown but disabled even with a commentable selection, so no draft can start. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { clearSessionBranches } from '@gonq/editor/features/github/sessionBranches';
import { editorView, selectText, settleEditors } from '@gonq/editor/testing/editor';
import { renderMobileApp } from '../testing/renderMobileApp';

beforeEach(() => {
  clearSessionBranches();
  invoke.mockReset().mockImplementation(async (cmd: string, a: Record<string, unknown>) => {
    switch (cmd) {
      case 'github_status':
        return { signed_in: true, login: 'octo', storage: 'keychain' };
      case 'github_list_repos':
        return { repos: [{ owner: 'o', name: 'r', full_name: 'o/r', private: false, default_branch: 'main', can_push: true, pushed_at: null }], next_page: null };
      case 'github_list_branches':
        return { default_branch: 'main', branches: ['main'], next_page: null };
      case 'github_list_folder':
        return { entries: [{ name: 'a.md', path: 'docs/a.md', kind: 'file' }], truncated: false };
      case 'github_read_file':
        return { path: a.path, name: 'a.md', content: 'The estimate holds through Q3.\n', sha: 'blob1', commit_sha: 'tip1' };
      case 'github_open_pulls_for_branches':
        return (a.branches as string[]).map((b) => ({ branch: b, pull: { number: 12, html_url: 'https://github.com/o/r/pull/12', draft: false, title: null } }));
      default:
        return [];
    }
  });
});

it('Add comment is shown but disabled on a read-only tab, even with a commentable selection', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await user.click(await screen.findByRole('button', { name: /o\/r/ }));
  await user.click(await screen.findByRole('button', { name: 'a.md' }));
  await screen.findByTestId('read-only-banner');
  await settleEditors(document.body);
  await waitFor(() => expect(editorView().state.readOnly).toBe(true));
  selectText('holds through Q3');
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  const sheet = await screen.findByRole('dialog', { name: 'Comments' });
  expect(within(sheet).getByRole('button', { name: 'Add comment' })).toBeDisabled();
  expect(within(sheet).queryByText('New comment')).toBeNull();
});
