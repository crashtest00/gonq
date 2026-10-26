/** File > Sign in to GitHub…: device code display, browser opening, approval, session-only note, cancel and sign out. */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import { GitHubSignInDialog } from './GitHubSignInDialog';
import { ensureSignedIn, type GitHubStatus } from '../platform/github';

vi.mock('../platform/lifecycle', () => ({ guardClose: () => () => {} }));
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const openUrl = vi.fn();
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: (...a: unknown[]) => openUrl(...a) }));

const out: GitHubStatus = { signed_in: false, login: null, storage: null };
const start = { user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 };
const approved: GitHubStatus = { signed_in: true, login: 'octo', storage: 'keychain' };

type Handler = (args: unknown) => unknown;
let handlers: Record<string, Handler>;
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd).length;

/** A poll that stays open until the test settles it. */
function deferredPoll() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  handlers.github_poll = () => p;
  return { resolve, reject };
}

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  openUrl.mockReset();
  handlers = {
    github_start: () => start,
    github_poll: () => new Promise(() => {}),
    github_status: () => out,
    github_sign_out: () => undefined,
  };
  invoke.mockImplementation(async (cmd: string, args: unknown) => {
    const h = handlers[cmd];
    if (!h) throw new Error(`unmocked ${cmd}`);
    return h(args);
  });
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const renderDialog = (status = out, onClose = vi.fn()) => {
  render(<GitHubSignInDialog status={status} onClose={onClose} />);
  return { user: userEvent.setup(), onClose };
};

it('shows the code large and copyable, and the waiting status', async () => {
  const { user } = renderDialog();
  await user.click(screen.getByRole('button', { name: 'Start' }));
  expect(await screen.findByLabelText('User code')).toHaveTextContent('ABCD-1234');
  expect(screen.getByText('https://github.com/login/device')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy code' })).toBeInTheDocument();
  expect(screen.getByText(/Waiting for approval/)).toBeInTheDocument();
});

it('opens the verification page in the browser', async () => {
  const { user } = renderDialog();
  await user.click(screen.getByRole('button', { name: 'Start' }));
  await user.click(await screen.findByRole('button', { name: /Open github.com\/login\/device/ }));
  expect(openUrl).toHaveBeenCalledWith('https://github.com/login/device');
});

it('keeps the code and address visible when the browser cannot be opened', async () => {
  openUrl.mockRejectedValue(new Error('no browser'));
  const { user } = renderDialog();
  await user.click(screen.getByRole('button', { name: 'Start' }));
  await user.click(await screen.findByRole('button', { name: /Open github.com\/login\/device/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('no browser');
  expect(screen.getByLabelText('User code')).toHaveTextContent('ABCD-1234');
  expect(screen.getByText('https://github.com/login/device')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy address' })).toBeInTheDocument();
});

it('says approved with the login once the poll resolves', async () => {
  const poll = deferredPoll();
  const { user, onClose } = renderDialog();
  await user.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByLabelText('User code');
  await act(async () => poll.resolve(approved));
  expect(await screen.findByText(/Signed in as octo/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Done' }));
  expect(onClose).toHaveBeenCalledWith(true);
  expect(calls('github_sign_out')).toBe(0);
});

it('notes that a session-only sign-in lasts for this session', async () => {
  const poll = deferredPoll();
  const { user } = renderDialog();
  await user.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByLabelText('User code');
  await act(async () => poll.resolve({ ...approved, storage: 'session_only' }));
  expect(await screen.findByText(/this session only/)).toBeInTheDocument();
});

it.each([
  [{ kind: 'access_denied' }, /denied/],
  [{ kind: 'expired' }, /expired/],
  [{ kind: 'network', message: 'timed out' }, /Could not reach GitHub/],
])('shows %j and offers another try', async (error, text) => {
  const poll = deferredPoll();
  const { user } = renderDialog();
  await user.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByLabelText('User code');
  await act(async () => poll.reject(error));
  expect(await screen.findByRole('alert')).toHaveTextContent(text);
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

it('Cancel stops the polling and closes; a late reply is ignored', async () => {
  const poll = deferredPoll();
  const { user, onClose } = renderDialog();
  await user.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByLabelText('User code');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(calls('github_sign_out')).toBe(1);
  expect(onClose).toHaveBeenCalledWith(false);
  await act(async () => poll.reject({ kind: 'cancelled' }));
});

it('stops polling when closed mid-approval, and reopening gives a fresh code', async () => {
  const first = renderDialog();
  await first.user.click(screen.getByRole('button', { name: 'Start' }));
  await screen.findByLabelText('User code');
  cleanup();
  expect(calls('github_sign_out')).toBe(1);
  handlers.github_start = () => ({ ...start, user_code: 'WXYZ-9999' });
  const second = renderDialog();
  await second.user.click(screen.getByRole('button', { name: 'Start' }));
  expect(await screen.findByLabelText('User code')).toHaveTextContent('WXYZ-9999');
});

it('does not stop anything on unmount when nothing is being polled', () => {
  renderDialog();
  cleanup();
  expect(calls('github_sign_out')).toBe(0);
});

it('already signed in: shows the login and signs out', async () => {
  const { user } = renderDialog(approved);
  expect(screen.getByText('Signed in as octo.')).toBeInTheDocument();
  expect(calls('github_start')).toBe(0);
  await user.click(screen.getByRole('button', { name: 'Sign out' }));
  expect(calls('github_sign_out')).toBe(1);
  expect(await screen.findByText('Signed out of GitHub.')).toBeInTheDocument();
});

it('already signed in with a session-only token says so', () => {
  renderDialog({ ...approved, storage: 'session_only' });
  expect(screen.getByText(/this session only/)).toBeInTheDocument();
});

it('shows a failed start', async () => {
  handlers.github_start = () => {
    throw { kind: 'network', message: 'connection failed' };
  };
  const { user } = renderDialog();
  await user.click(screen.getByRole('button', { name: 'Start' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('connection failed');
});

const openFile = async (user: ReturnType<typeof userEvent.setup>, name: RegExp) => {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name }));
};

it('File > Sign in to GitHub… opens the dialog', async () => {
  render(<App />);
  const user = userEvent.setup();
  await openFile(user, /Sign in to GitHub/);
  expect(await screen.findByRole('dialog', { name: 'Sign in to GitHub' })).toBeInTheDocument();
});

it('File > Sign in to GitHub… when signed in shows the login', async () => {
  handlers.github_status = () => approved;
  render(<App />);
  await openFile(userEvent.setup(), /Sign in to GitHub/);
  expect(await screen.findByText('Signed in as octo.')).toBeInTheDocument();
});

it('File > Sign out of GitHub deletes the token and confirms', async () => {
  render(<App />);
  await openFile(userEvent.setup(), /Sign out of GitHub/);
  await waitFor(() => expect(calls('github_sign_out')).toBe(1));
  expect(await screen.findByText('Signed out of GitHub.')).toBeInTheDocument();
});

it('on the web both items show the desktop-app error in the banner', async () => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  render(<App />);
  const user = userEvent.setup();
  await openFile(user, /Sign in to GitHub/);
  expect(await screen.findByText('Signing in to GitHub needs the Gonq desktop app')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
  await openFile(user, /Sign out of GitHub/);
  expect(await screen.findByText('Signing in to GitHub needs the Gonq desktop app')).toBeInTheDocument();
});

it('ensureSignedIn runs the dialog and returns once it closes', async () => {
  render(<App />);
  const user = userEvent.setup();
  let done: boolean | null = null;
  const pending = ensureSignedIn().then((v) => (done = v));
  await screen.findByRole('dialog', { name: 'Sign in to GitHub' });
  expect(done).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await pending;
  expect(done).toBe(false);
  expect(screen.queryByRole('dialog')).toBeNull();
});
