/** Navigator Refresh (plain, branch still exists) leaves open tabs, unsaved edits and the current-file highlight untouched and never switches branch. */
import { cleanup, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { docText, settleEditors, type } from '@gonq/editor/testing/editor';
import { openGithub } from '@gonq/editor/platform/files';
import { renderApp } from '../../testing/renderApp';
import { githubPath } from '@gonq/editor/platform/github';

const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (cmd === 'recent_documents_list') return [{ path: githubPath({ owner: 'octo', repo: 'notes', branch: 'dev', path: 'a.md' }), opened_at: 1 }];
  if (cmd === 'recent_documents_add' || cmd === 'recent_documents_remove') return [];
  if (cmd === 'take_launch_paths') return [];
  if (cmd === 'github_status') return { signed_in: true, login: 'me', storage: 'keychain' };
  if (cmd === 'github_list_branches') return { default_branch: 'main', branches: ['main', 'dev'], next_page: null };
  if (cmd === 'github_list_folder') return { entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }, { name: 'b.md', path: 'b.md', kind: 'file' }], truncated: false };
  if (cmd === 'github_read_file') return { path: args!.path, name: String(args!.path), content: `# ${args!.path}\n\nbody of ${args!.path}`, sha: 's', commit_sha: 'c' };
  return undefined;
});
vi.mock('@gonq/editor/platform/bindings', async () => (await import('@gonq/editor/testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));
vi.mock('@gonq/editor/platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('@gonq/editor/platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

it('a plain refresh keeps the unsaved edit, the tab, the highlighted file row and the branch, and never asks', async () => {
  const { user } = renderApp({ files: { openPath: openGithub } });
  await user.click(screen.getByTitle('Folder navigator'));
  await user.click(await screen.findByRole('button', { name: /^a\.md.*@ dev/ }));
  await screen.findByText('body of a.md');
  await settleEditors(document.body);
  await screen.findByRole('button', { name: 'Branch: dev' });
  type('X');
  expect(await screen.findByLabelText('unsaved changes')).toBeInTheDocument();
  const before = docText();
  const tabs = screen.getAllByRole('tab').map((t) => t.textContent);
  const highlighted = () => [...document.querySelectorAll('[aria-current="true"]')].map((e) => e.textContent);
  await waitFor(() => expect(highlighted()).toEqual(['a.md']));

  const listed = invoke.mock.calls.filter((c) => c[0] === 'github_list_folder').length;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(invoke.mock.calls.filter((c) => c[0] === 'github_list_folder').length).toBeGreaterThan(listed));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());

  expect(screen.queryByRole('dialog')).toBeNull();
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
  expect(docText()).toBe(before);
  expect(screen.getAllByRole('tab').map((t) => t.textContent)).toEqual(tabs);
  expect(screen.getByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
  expect(highlighted()).toEqual(['a.md']);
});

it('with two tabs open a refresh keeps both, the active one and its highlighted row, and reads no file again', async () => {
  const { user } = renderApp({ files: { openPath: openGithub } });
  await user.click(screen.getByTitle('Folder navigator'));
  await user.click(await screen.findByRole('button', { name: /^a\.md.*@ dev/ }));
  await screen.findByText('body of a.md');
  await user.click(await screen.findByRole('button', { name: 'b.md' }));
  await screen.findByText('body of b.md');
  await settleEditors(document.body);
  const tabs = () => screen.getAllByRole('tab').map((t) => `${t.textContent}:${t.getAttribute('aria-selected')}`);
  const highlighted = () => [...document.querySelectorAll('[aria-current="true"]')].map((e) => e.textContent);
  await waitFor(() => expect(highlighted()).toEqual(['b.md']));
  const before = tabs();
  expect(before).toHaveLength(2);
  expect(before.filter((t) => t.endsWith(':true'))).toHaveLength(1);

  const reads = () => invoke.mock.calls.filter((c) => c[0] === 'github_read_file').length;
  const listed = invoke.mock.calls.filter((c) => c[0] === 'github_list_folder').length;
  const readsBefore = reads();
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(invoke.mock.calls.filter((c) => c[0] === 'github_list_folder').length).toBeGreaterThan(listed));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());

  expect(tabs()).toEqual(before);
  expect(highlighted()).toEqual(['b.md']);
  expect(screen.getByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
  expect(reads()).toBe(readsBefore);
  expect(screen.queryByRole('dialog')).toBeNull();
});
