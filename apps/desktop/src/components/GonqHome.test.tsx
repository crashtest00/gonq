/** The desktop Gonq home shown with no tab open: logo, New / Open Folder… / Open Repo… running their commands, recents (order, no remove buttons, same list as the sidebar), replaced by the editor on open and back after the last tab closes. */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () => (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)));
vi.mock('@gonq/editor/platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('@gonq/editor/platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));

const open = vi.hoisted(() => vi.fn(async () => null));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open }));

import { renderApp, testDoc } from '../testing/renderApp';

type Row = { path: string; opened_at: number };
let store: Row[] = [];
const seed = (paths: string[]) => (store = paths.map((path, i) => ({ path, opened_at: Date.now() - i * 1000 })));

beforeEach(() => {
  store = [];
  localStorage.clear();
  invoke.mockReset().mockImplementation((cmd: string, args?: { path?: string }) => {
    if (cmd === 'recent_documents_list') return Promise.resolve(store);
    if (cmd === 'recent_documents_add') {
      store = [{ path: args!.path!, opened_at: Date.now() }, ...store.filter((r) => r.path !== args!.path)];
      return Promise.resolve(store);
    }
    if (cmd === 'path_exists') return Promise.resolve(true);
    if (cmd === 'take_launch_paths') return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

const home = () => screen.getByTestId('gonq-home');

it('shows the logo and the three entry points, and the old line is gone', async () => {
  renderApp();
  expect(within(home()).getByRole('img', { name: 'Gonq logo' })).toHaveAttribute('src', expect.stringContaining('gonq-logo-OUTLINE.svg'));
  for (const name of ['New', 'Open Folder…', 'Open Repo…']) expect(within(home()).getByRole('button', { name })).toBeInTheDocument();
  expect(screen.queryByText('Open a document or create a new one.')).toBeNull();
});

it('lists the recents most recent first with no remove buttons, matching the sidebar', async () => {
  seed(['/d/a.md', 'github://octo/docs@main/x/b.md', '/d/c.md']);
  const { user } = renderApp();
  await within(home()).findByRole('button', { name: /Open a\.md from home/ });
  const names = within(home()).getAllByRole('listitem').map((li) => li.textContent);
  expect(names[0]).toMatch(/^a\.md/);
  expect(names[1]).toMatch(/^b\.md.*octo\/docs @ main/);
  expect(names[2]).toMatch(/^c\.md/);
  expect(within(home()).queryByRole('button', { name: /Remove/ })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  const sidebar = await screen.findByRole('navigation');
  const side = within(sidebar).getAllByRole('listitem').map((li) => li.textContent?.replace(/\s+/g, ' ').slice(0, 4));
  expect(side).toEqual(names.map((n) => n?.slice(0, 4)));
});

it('Open Folder… and Open Repo… run their commands; New opens an empty tab', async () => {
  const { user } = renderApp();
  await user.click(within(home()).getByRole('button', { name: 'Open Repo…' }));
  await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  await user.click(within(home()).getByRole('button', { name: 'New' }));
  expect(await screen.findByRole('tab', { name: /Untitled/ })).toBeInTheDocument();
  expect(screen.queryByTestId('gonq-home')).toBeNull();
});

it('Open Folder… runs the open-folder command', async () => {
  const { user } = renderApp();
  await user.click(within(home()).getByRole('button', { name: 'Open Folder…' }));
  await waitFor(() => expect(open).toHaveBeenCalledWith(expect.objectContaining({ directory: true })));
});

it('opening a recent replaces the home with the editor, and closing the last tab brings it back', async () => {
  seed(['/d/a.md']);
  const { user } = renderApp({ files: { openPath: vi.fn(async (p: string) => testDoc('# A', p)) } });
  await user.click(await within(home()).findByRole('button', { name: /Open a\.md from home/ }));
  await screen.findByRole('tab');
  expect(screen.queryByTestId('gonq-home')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: 'Close a.md' }));
  expect(await screen.findByTestId('gonq-home')).toBeInTheDocument();
});
