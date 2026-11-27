/** File > Open Recent: placed after Open…, disabled (not hidden) without recents, lists the sidebar's recents in order (max 10, detail for GitHub), opens one as the sidebar does, and moves an opened document to the top. */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () => (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)));
vi.mock('@gonq/editor/platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('@gonq/editor/platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));

import { renderApp, testDoc } from '../../testing/renderApp';

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

const openFileMenu = async (user: ReturnType<typeof renderApp>['user']) => {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  return screen.findByRole('menuitem', { name: 'Open Recent' });
};

it('is a File submenu right after Open…', async () => {
  const { user } = renderApp();
  await openFileMenu(user);
  const names = screen.getAllByRole('menuitem').map((e) => e.textContent);
  expect(names.findIndex((n) => n?.startsWith('Open Recent'))).toBe(names.findIndex((n) => n?.startsWith('Open…')) + 1);
});

it('is shown disabled with no recents', async () => {
  const { user } = renderApp();
  expect(await openFileMenu(user)).toHaveAttribute('aria-disabled', 'true');
});

it('lists the recents most recent first, at most 10, with GitHub detail', async () => {
  seed(['/d/a.md', 'github://octo/docs@main/x/b.md', ...Array.from({ length: 12 }, (_, i) => `/d/f${i}.md`)]);
  const { user } = renderApp();
  const trigger = await openFileMenu(user);
  await waitFor(() => expect(trigger).not.toHaveAttribute('aria-disabled', 'true'));
  await user.click(trigger);
  const sub = (await screen.findByRole('menuitem', { name: 'a.md' })).closest('[role="menu"]') as HTMLElement;
  const labels = within(sub).getAllByRole('menuitem').map((e) => e.textContent);
  expect(labels).toHaveLength(10);
  expect(labels.slice(0, 3)).toEqual(['a.md', 'b.md — octo/docs @ main', 'f0.md']);
});

it('opens a recent as the sidebar does (allow, existence check, read) and moves it to the top', async () => {
  seed(['/d/a.md', '/d/b.md']);
  const openPath = vi.fn(async (p: string) => testDoc('# B', p));
  const { user } = renderApp({ files: { openPath } });
  const trigger = await openFileMenu(user);
  await waitFor(() => expect(trigger).not.toHaveAttribute('aria-disabled', 'true'));
  await user.click(trigger);
  fireEvent.click(await screen.findByRole('menuitem', { name: 'b.md' }));
  await waitFor(() => expect(openPath).toHaveBeenCalledWith('/d/b.md'));
  expect(invoke).toHaveBeenCalledWith('allow_recent_document', { path: '/d/b.md' });
  await waitFor(() => expect(store[0].path).toBe('/d/b.md'));

  await user.click(await openFileMenu(user));
  const sub = (await screen.findAllByRole('menuitem', { name: /^[ab]\.md$/ })).map((e) => e.textContent);
  expect(sub).toEqual(['b.md', 'a.md']);
});
