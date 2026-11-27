/** The GitHub menu: its five items in order, Sign In / Sign Out greyed by the signed-in state, and each running its flow. */
import { screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () => (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)));

vi.mock('@gonq/editor/platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('@gonq/editor/platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));

import { renderApp, menu } from '../../testing/renderApp';

let signedIn = false;
beforeEach(() => {
  signedIn = false;
  localStorage.clear();
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'github_status') return Promise.resolve({ signed_in: signedIn, login: signedIn ? 'octo' : null, storage: 'keychain' });
    if (cmd === 'github_sign_out') {
      signedIn = false;
      return Promise.resolve(undefined);
    }
    if (cmd === 'take_launch_paths') return Promise.resolve([]);
    if (cmd === 'recent_documents_list') return Promise.resolve([]);
    return Promise.resolve(undefined);
  });
});

async function items(user: ReturnType<typeof renderApp>['user']) {
  await user.click(screen.getByRole('menuitem', { name: 'GitHub' }));
  await screen.findByRole('menuitem', { name: 'Sign In' });
  return screen.getAllByRole('menuitem').filter((e) => e.closest('[role="menu"]') !== null && /^(Sign|Open|Commit)/.test(e.textContent ?? ''));
}

it('lists Sign In, Sign Out, Open Repo…, Commit…, Open PR… in order; signed out greys Sign Out', async () => {
  const { user } = renderApp();
  const list = await items(user);
  expect(list.map((e) => e.textContent)).toEqual(['Sign In', 'Sign Out', 'Open Repo…', 'Commit…', 'Open PR…']);
  expect(list[0]).not.toHaveAttribute('aria-disabled', 'true');
  expect(list[1]).toHaveAttribute('aria-disabled', 'true');
  expect(list[3]).toHaveAttribute('aria-disabled', 'true');
  expect(list[4]).toHaveAttribute('aria-disabled', 'true');
});

it('signed in greys Sign In and enables Sign Out, which signs out', async () => {
  signedIn = true;
  const { user } = renderApp();
  await screen.findByRole('menuitem', { name: 'GitHub' });
  await user.click(screen.getByRole('menuitem', { name: 'GitHub' }));
  const out = await screen.findByRole('menuitem', { name: 'Sign Out' });
  await vi.waitFor(() => expect(out).not.toHaveAttribute('aria-disabled', 'true'));
  expect(screen.getByRole('menuitem', { name: 'Sign In' })).toHaveAttribute('aria-disabled', 'true');
  await user.click(out);
  await vi.waitFor(() => expect(invoke).toHaveBeenCalledWith('github_sign_out', undefined));
  await user.click(screen.getByRole('menuitem', { name: 'GitHub' }));
  expect(await screen.findByRole('menuitem', { name: 'Sign In' })).not.toHaveAttribute('aria-disabled', 'true');
});

it('Sign In opens Settings on the sign-in flow', async () => {
  const { user } = renderApp();
  await menu(user, 'GitHub', 'Sign In');
  expect(await screen.findByRole('dialog', { name: 'Settings' })).toBeInTheDocument();
});
