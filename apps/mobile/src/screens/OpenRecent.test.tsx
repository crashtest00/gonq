/** Covers File > Open Recent in the mobile ⋯ menu through renderMobileApp: after Open…, shown disabled with no recents, lists the home's recents (same order, max 10, same detail), choosing one takes the home's path (allowRecentDocument, then the read) and the opened document moves to the top. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () => (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)));
const calls: string[] = [];
vi.mock('@tauri-apps/plugin-fs', async (orig) => ({
  ...(await orig<object>()),
  readFile: vi.fn(async () => {
    calls.push('read');
    return new TextEncoder().encode('# Hi');
  }),
}));

import { renderMobileApp } from '../testing/renderMobileApp';

type Row = { path: string; opened_at: number };
let store: Row[] = [];
const seed = (paths: string[]) => (store = paths.map((path, i) => ({ path, opened_at: Date.now() - i * 1000 })));

beforeEach(() => {
  store = [];
  calls.length = 0;
  localStorage.clear();
  invoke.mockReset().mockImplementation((cmd: string, args?: { path?: string }) => {
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: 'a', storage: 'keychain' });
    if (cmd === 'recent_documents_list') return Promise.resolve(store);
    if (cmd === 'recent_documents_add') {
      store = [{ path: args!.path!, opened_at: Date.now() }, ...store.filter((r) => r.path !== args!.path)];
      return Promise.resolve(store);
    }
    if (cmd === 'allow_recent_document') calls.push('allow');
    if (cmd === 'path_exists') return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

const fileMenu = () => screen.getByRole('menu', { name: 'File' });
const recentGroup = () => within(fileMenu()).getByRole('group', { name: 'Open Recent' });

it('sits right after Open… and is shown disabled with no recents', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'More' }));
  const ids = [...fileMenu().querySelectorAll('[data-command]')].map((e) => e.getAttribute('data-command'));
  expect(ids.slice(0, 2)).toEqual(['file.new', 'file.open']);
  expect(recentGroup()).toHaveAttribute('aria-disabled', 'true');
});

it('lists the home recents in order, at most 10, with the home detail', async () => {
  seed(['/d/a.md', 'github://octo/docs@main/x/b.md', ...Array.from({ length: 12 }, (_, i) => `/d/f${i}.md`)]);
  const { user } = await renderMobileApp();
  await screen.findAllByRole('listitem');
  await user.click(screen.getByRole('button', { name: 'More' }));
  const labels = within(recentGroup()).getAllByRole('menuitem').map((e) => e.textContent);
  expect(labels).toHaveLength(10);
  expect(labels.slice(0, 3)).toEqual(['a.md', 'b.md — octo/docs @ main', 'f0.md']);
  expect(within(recentGroup()).getAllByRole('menuitem')[0]).toHaveClass('m-tap');
});

it('opens a recent as the home row does: allowRecentDocument first, then the read; it moves to the top', async () => {
  seed(['/d/a.md', '/d/b.md']);
  const { user } = await renderMobileApp();
  await screen.findAllByRole('listitem');
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(within(recentGroup()).getByRole('menuitem', { name: 'b.md' }));
  await waitFor(() => expect(calls).toEqual(['allow', 'read']));
  await waitFor(() => expect(store[0].path).toBe('/d/b.md'));
});
