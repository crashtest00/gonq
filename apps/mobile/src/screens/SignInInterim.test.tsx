/** Covers the interim sign-in screen through renderMobileApp with mocked bindings: every step of the device flow, copy/open, signed in, session only, sign out and the web error banner. */
import { act, screen, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
const copyText = vi.fn();
const openExternal = vi.fn();
vi.mock('@gonq/editor/platform/clipboard', () => ({
  copyText: (t: string) => copyText(t),
}));
vi.mock('@gonq/editor/platform/external', () => ({
  openExternal: (u: string) => openExternal(u),
}));

import { renderMobileApp } from '../testing/renderMobileApp';

const begun = {
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};
const out = { signed_in: false, login: null, storage: null };
let poll: { resolve: (v: unknown) => void; reject: (e: unknown) => void };

function native() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  copyText.mockReset().mockResolvedValue(undefined);
  openExternal.mockReset().mockResolvedValue(undefined);
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'github_status') return Promise.resolve(out);
    if (cmd === 'github_start') return Promise.resolve(begun);
    if (cmd === 'github_poll') return new Promise((resolve, reject) => (poll = { resolve, reject }));
    if (cmd === 'github_sign_out') return Promise.resolve();
    return Promise.resolve({ pending: false, expires_at_ms: null });
  });
});

async function toCode() {
  native();
  const r = await renderMobileApp();
  await r.user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
  await r.user.click(await screen.findByRole('button', { name: 'Start' }));
  await screen.findByLabelText('User code');
  return r;
}

it('opens from the Documents home row and shows idle with Start', async () => {
  native();
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
  expect(screen.getByRole('heading', { name: 'Sign in to GitHub' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Start' })).toBeInTheDocument();
});

it('shows the code, copies it and opens github.com/login/device while waiting', async () => {
  const { user } = await toCode();
  expect(screen.getByLabelText('User code')).toHaveTextContent('WDJB-MJHT');
  expect(screen.getByText('Waiting for approval on github.com…')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Copy code' }));
  expect(copyText).toHaveBeenCalledWith('WDJB-MJHT');
  expect(await screen.findByText('Copied')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open github.com/login/device' }));
  expect(openExternal).toHaveBeenCalledWith('https://github.com/login/device');
});

it('shows the denied and expired states with Try again', async () => {
  for (const [kind, text] of [
    ['access_denied', 'Sign-in was denied on github.com.'],
    ['expired', 'The code expired before it was approved.'],
  ]) {
    const { user, unmount } = await toCode();
    await act(async () => poll.reject({ kind }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('User code');
    unmount();
  }
});

it('shows the login once approved, then signs out', async () => {
  const { user } = await toCode();
  await act(async () => poll.resolve({ signed_in: true, login: 'octo', storage: 'keychain' }));
  expect(await screen.findByText('Signed in as octo.')).toBeInTheDocument();
  expect(screen.queryByText(/session only/)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Sign Out' }));
  expect(invoke).toHaveBeenCalledWith('github_sign_out', undefined);
  expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
});

it('shows the session-only sentence for a session_only sign-in', async () => {
  native();
  invoke.mockImplementation((cmd: string) =>
    Promise.resolve(cmd === 'github_status' ? { signed_in: true, login: 'octo', storage: 'session_only' } : undefined),
  );
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
  expect(await screen.findByText('Signed in as octo.')).toBeInTheDocument();
  expect(screen.getByText(/session only/)).toBeInTheDocument();
});

it('on the web, Start shows the platform error in the shell banner and stays enabled', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
  await user.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Signing in to GitHub needs the Gonq desktop app'));
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(invoke).not.toHaveBeenCalled();
});
