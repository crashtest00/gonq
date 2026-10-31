/** Covers the mobile GitHub sign-in screen through renderMobileApp with mocked bindings: every state, copy feedback, open failure, no auto-start, session-only vs keychain, ensureSignedIn reachability, web wording and the opener allow-list. */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
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

import { ensureSignedIn } from '@gonq/editor/platform/github';
import { renderMobileApp } from '../testing/renderMobileApp';

const begun = {
  user_code: 'WDJB-MJHT',
  verification_uri: 'https://github.com/login/device',
  expires_in: 900,
  interval: 5,
};
const out = { signed_in: false, login: null, storage: null };
let poll: { resolve: (v: unknown) => void; reject: (e: unknown) => void };
let status: unknown;

function native() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  status = out;
  copyText.mockReset().mockResolvedValue(undefined);
  openExternal.mockReset().mockResolvedValue(undefined);
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'github_status') return Promise.resolve(status);
    if (cmd === 'github_start') return Promise.resolve(begun);
    if (cmd === 'github_poll') return new Promise((resolve, reject) => (poll = { resolve, reject }));
    if (cmd === 'github_sign_out') return Promise.resolve();
    return Promise.resolve({ pending: false, expires_at_ms: null });
  });
});

async function toIdle() {
  native();
  const r = await renderMobileApp();
  await r.user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
  await screen.findByRole('button', { name: 'Start' });
  return r;
}

async function toCode() {
  const r = await toIdle();
  await r.user.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByLabelText('User code');
  return r;
}

it('idle: the desktop sentence, Cancel and Start, and no code is requested before Start', async () => {
  await toIdle();
  expect(screen.getByText('Gonq shows a code to type on github.com. Your password and token never pass through this window.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  expect(invoke).not.toHaveBeenCalledWith('github_start', expect.anything());
  expect(invoke.mock.calls.map((c) => c[0])).not.toContain('github_start');
});

it('Cancel on idle goes back to the Documents home', async () => {
  const { user } = await toIdle();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
});

it('starting: shows "Asking GitHub for a code…" with Cancel', async () => {
  invoke.mockImplementation((cmd: string) =>
    cmd === 'github_start' ? new Promise(() => {}) : Promise.resolve(cmd === 'github_status' ? out : undefined),
  );
  native();
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
  await user.click(await screen.findByRole('button', { name: 'Start' }));
  expect(await screen.findByText('Asking GitHub for a code…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

it('waiting: code, address text, copy first then open, each one tap, with Copied feedback', async () => {
  const { user } = await toCode();
  expect(screen.getByText('Enter this code on GitHub:')).toBeInTheDocument();
  expect(screen.getByLabelText('User code')).toHaveTextContent('WDJB-MJHT');
  expect(screen.getByText('https://github.com/login/device')).toBeInTheDocument();
  expect(screen.getByText('Waiting for approval on github.com…')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Copy code' }));
  expect(copyText).toHaveBeenCalledWith('WDJB-MJHT');
  expect(await screen.findByText('Copied')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Copy address' }));
  expect(copyText).toHaveBeenCalledWith('https://github.com/login/device');
  expect(openExternal).not.toHaveBeenCalled();
  await user.click(screen.getByRole('button', { name: 'Open github.com/login/device' }));
  expect(openExternal).toHaveBeenCalledTimes(1);
  expect(openExternal).toHaveBeenCalledWith('https://github.com/login/device');
  const names = screen.getAllByRole('button').map((b) => b.getAttribute('aria-label') ?? b.textContent);
  expect(names.indexOf('Copy code')).toBeLessThan(names.indexOf('Open github.com/login/device'));
});

it('shows Copy failed when the clipboard rejects', async () => {
  copyText.mockRejectedValue(new Error('no clipboard'));
  const { user } = await toCode();
  await user.click(screen.getByRole('button', { name: 'Copy code' }));
  expect(await screen.findByText('Copy failed')).toBeInTheDocument();
});

it('shows the open-failure alert when the browser cannot be opened', async () => {
  openExternal.mockRejectedValue(new Error('no browser'));
  const { user } = await toCode();
  await user.click(screen.getByRole('button', { name: 'Open github.com/login/device' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Could not open the browser (no browser). Open the address above yourself and type the code.',
  );
});

it('denied and expired offer Cancel and Try again; expired has no code box', async () => {
  for (const [kind, text] of [
    ['access_denied', 'Sign-in was denied on github.com.'],
    ['expired', 'The code expired before it was approved.'],
  ]) {
    const { user, unmount } = await toCode();
    await act(async () => poll.reject({ kind }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByLabelText('User code')).toBeNull();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByLabelText('User code');
    unmount();
  }
});

it('failed shows the error text with Cancel and Try again', async () => {
  const { user } = await toCode();
  await act(async () => poll.reject({ kind: 'network', message: 'offline' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/offline/);
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByLabelText('User code');
});

it('approved with keychain: title, login, Done, and no session-only notice', async () => {
  const { user } = await toCode();
  await act(async () => poll.resolve({ signed_in: true, login: 'octo', storage: 'keychain' }));
  expect(await screen.findByRole('heading', { name: 'Signed in to GitHub' })).toBeInTheDocument();
  expect(screen.getByText('Approved. Signed in as octo.')).toBeInTheDocument();
  expect(screen.queryByText(/session only/)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
});

it('approved without a login says "You are signed in." and session_only adds the notice', async () => {
  await toCode();
  await act(async () => poll.resolve({ signed_in: true, login: null, storage: 'session_only' }));
  expect(await screen.findByText('Approved. You are signed in.')).toBeInTheDocument();
  expect(screen.getByText('No keychain is available, so this sign-in lasts for this session only.')).toBeInTheDocument();
});

it('already signed in shows @login only, no avatar or badge, and can sign out', async () => {
  status = { signed_in: true, login: 'octo', storage: 'keychain' };
  native();
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
  expect(await screen.findByText('@octo')).toBeInTheDocument();
  expect(screen.queryByRole('img')).toBeNull();
  expect(screen.queryByText(/session only/)).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Sign Out' }));
  expect(invoke).toHaveBeenCalledWith('github_sign_out', undefined);
  expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
});

it('already signed in with session_only shows the notice', async () => {
  status = { signed_in: true, login: 'octo', storage: 'session_only' };
  native();
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
  expect(await screen.findByText('@octo')).toBeInTheDocument();
  expect(screen.getByText(/session only/)).toBeInTheDocument();
});

it('ensureSignedIn opens the screen and resolves true after approval and Done', async () => {
  native();
  const { user } = await renderMobileApp();
  let result: boolean | undefined;
  await act(async () => {
    void ensureSignedIn().then((v) => (result = v));
  });
  await user.click(await screen.findByRole('button', { name: 'Start' }));
  await screen.findByLabelText('User code');
  status = { signed_in: true, login: 'octo', storage: 'keychain' };
  await act(async () => poll.resolve(status));
  expect(result).toBeUndefined();
  await user.click(await screen.findByRole('button', { name: 'Done' }));
  await waitFor(() => expect(result).toBe(true));
});

it('ensureSignedIn resolves false when the user cancels', async () => {
  native();
  const { user } = await renderMobileApp();
  let result: boolean | undefined;
  await act(async () => {
    void ensureSignedIn().then((v) => (result = v));
  });
  await user.click(await screen.findByRole('button', { name: 'Cancel' }));
  await waitFor(() => expect(result).toBe(false));
});

it('on mobile web, Start shows the "Gonq app" error in the shell banner and stays retryable', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
  await user.click(screen.getByRole('button', { name: 'Start' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('Signing in to GitHub needs the Gonq app'));
  expect(screen.getByRole('alert')).not.toHaveTextContent('desktop');
  expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
  expect(invoke).not.toHaveBeenCalled();
});

it('keeps the opener allow-list in mobile.json exactly as it is', () => {
  const cap = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/capabilities/mobile.json'), 'utf8'));
  const opener = cap.permissions.find((p: unknown) => typeof p === 'object' && (p as { identifier: string }).identifier === 'opener:allow-open-url');
  expect(opener.allow).toEqual([{ url: 'https://github.com/crashtest00/gonq' }, { url: 'https://github.com/login/device' }, { url: 'https://github.com/*/pull/*' }]);
});
