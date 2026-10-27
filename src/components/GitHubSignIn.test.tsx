/** Settings > GitHub (Sign In / Sign Out) and the device-flow panel inside it: code display, browser opening, approval, session-only note, cancel, and the end-to-end sign-in through Settings. */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import { GitHubSignInPanel } from './GitHubSignInPanel';
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

const renderDialog = (onClose = vi.fn()) => {
  render(<GitHubSignInPanel onClose={onClose} />);
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

it('shows a failed start', async () => {
  handlers.github_start = () => {
    throw { kind: 'network', message: 'connection failed' };
  };
  const { user } = renderDialog();
  await user.click(screen.getByRole('button', { name: 'Start' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('connection failed');
});

const openSettings = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
  await user.click(await screen.findByRole('menuitem', { name: /Settings/ }));
  return screen.findByRole('dialog', { name: 'Settings' });
};

it('File menu no longer lists the GitHub sign-in items', async () => {
  render(<App />);
  await userEvent.setup().click(screen.getByRole('menuitem', { name: 'File' }));
  await screen.findByRole('menuitem', { name: /Open Repo/ });
  expect(screen.queryByRole('menuitem', { name: /Sign (in|out)/ })).toBeNull();
});

it('Settings > Sign In runs the device flow inside Settings and ends signed in with a Sign Out', async () => {
  let signedIn = false;
  handlers.github_status = () => (signedIn ? approved : out);
  handlers.github_poll = async () => {
    signedIn = true;
    return approved;
  };
  render(<App />);
  const user = userEvent.setup();
  const settings = await openSettings(user);
  expect(await within(settings).findByText('Not signed in.')).toBeInTheDocument();
  await user.click(within(settings).getByRole('button', { name: 'Sign In' }));
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  await user.click(await within(settings).findByRole('button', { name: 'Start' }));
  expect(await within(settings).findByText(/Approved/)).toBeInTheDocument();
  await user.click(within(settings).getByRole('button', { name: 'Done' }));
  expect(await within(settings).findByText('Signed in as octo.')).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Settings' })).toBe(settings);
  signedIn = false;
  await user.click(within(settings).getByRole('button', { name: 'Sign Out' }));
  expect(await within(settings).findByText('Not signed in.')).toBeInTheDocument();
  expect(calls('github_sign_out')).toBe(1);
});

it('Settings shows the login and Sign Out deletes the token', async () => {
  handlers.github_status = () => approved;
  render(<App />);
  const user = userEvent.setup();
  const settings = await openSettings(user);
  expect(await within(settings).findByText('Signed in as octo.')).toBeInTheDocument();
  handlers.github_status = () => out;
  await user.click(within(settings).getByRole('button', { name: 'Sign Out' }));
  await waitFor(() => expect(calls('github_sign_out')).toBe(1));
  expect(await within(settings).findByText('Not signed in.')).toBeInTheDocument();
  expect(within(settings).getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
});

it('on the web Settings says it needs the desktop app and Sign In shows the error in Settings', async () => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  render(<App />);
  const user = userEvent.setup();
  const settings = await openSettings(user);
  expect(await within(settings).findByText('GitHub sign-in needs the Gonq desktop app.')).toBeInTheDocument();
  await user.click(within(settings).getByRole('button', { name: 'Sign In' }));
  await user.click(await within(settings).findByRole('button', { name: 'Start' }));
  expect(await within(settings).findByRole('alert')).toHaveTextContent('Signing in to GitHub needs the Gonq desktop app');
});

it('ensureSignedIn opens Settings already signing in and returns once it closes', async () => {
  render(<App />);
  const user = userEvent.setup();
  let done: boolean | null = null;
  const pending = ensureSignedIn().then((v) => (done = v));
  const settings = await screen.findByRole('dialog', { name: 'Settings' });
  expect(await within(settings).findByRole('button', { name: 'Start' })).toBeInTheDocument();
  expect(done).toBeNull();
  await user.click(within(settings).getAllByRole('button', { name: 'Cancel' })[0]);
  await pending;
  expect(done).toBe(false);
  expect(screen.queryByRole('dialog')).toBeNull();
});
