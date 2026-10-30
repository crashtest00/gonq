/** File > Open Repo…: paged loading, filtering, empty/no-match messages, marks, errors and retry. */
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import App from '../App';
import { RepoPickerDialog } from './RepoPickerDialog';

vi.mock('@gonq/editor/platform/lifecycle', () => ({ guardClose: () => () => {} }));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () => (await import('@gonq/editor/testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));

const out = { signed_in: false, login: null, storage: null };
const inn = { signed_in: true, login: 'octo', storage: 'keychain' };

const raw = (owner: string, name: string, over: Record<string, unknown> = {}) => ({
  owner,
  name,
  full_name: `${owner}/${name}`,
  private: false,
  default_branch: 'main',
  can_push: true,
  pushed_at: null,
  ...over,
});

type Handler = (args: unknown) => unknown;
let handlers: Record<string, Handler>;
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  invoke.mockReset();
  handlers = {
    github_status: () => inn,
    github_start: () => ({ user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }),
    github_poll: () => new Promise(() => {}),
    github_sign_out: () => undefined,
    github_list_repos: () => ({ repos: [], next_page: null }),
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

const renderPicker = () => {
  const props = { onChoose: vi.fn(), onClose: vi.fn(), onSignedOut: vi.fn() };
  render(<RepoPickerDialog {...props} />);
  return { ...props, user: userEvent.setup() };
};

const rows = () => within(screen.getByRole('list', { name: 'Repositories' })).queryAllByRole('listitem');

/** A page request that stays open until the test settles it. */
function deferred() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { p, resolve, reject };
}

it('loads pages in order, shows rows as each arrives, and a loading indicator until the last', async () => {
  const second = deferred();
  handlers.github_list_repos = (a) =>
    (a as { page: number }).page === 1 ? { repos: [raw('octo', 'one')], next_page: 2 } : second.p;
  renderPicker();
  expect(await screen.findByText('octo/one')).toBeInTheDocument();
  await waitFor(() => expect(calls('github_list_repos').map((c) => c[1])).toEqual([{ page: 1 }, { page: 2 }]));
  expect(screen.getByText('Loading more…')).toBeInTheDocument();
  await act(async () => second.resolve({ repos: [raw('acme', 'two')], next_page: null }));
  expect(await screen.findByText('acme/two')).toBeInTheDocument();
  expect(rows()).toHaveLength(2);
  expect(screen.queryByText('Loading more…')).toBeNull();
  expect(calls('github_list_repos')).toHaveLength(2);
});

it('filters case-insensitively on owner/repo without refetching', async () => {
  handlers.github_list_repos = () => ({ repos: [raw('Octo', 'Alpha'), raw('acme', 'beta'), raw('acme', 'OCTOpus')], next_page: null });
  const { user } = renderPicker();
  await screen.findByText('Octo/Alpha');
  await user.type(screen.getByLabelText('Filter repositories'), 'oCTO');
  expect(rows().map((r) => r.textContent)).toEqual(['Octo/Alpha', 'acme/OCTOpus']);
  await user.clear(screen.getByLabelText('Filter repositories'));
  await user.type(screen.getByLabelText('Filter repositories'), 'acme/b');
  expect(rows().map((r) => r.textContent)).toEqual(['acme/beta']);
  expect(calls('github_list_repos')).toHaveLength(1);
});

it('says so when the filter matches nothing, differently from an empty account', async () => {
  handlers.github_list_repos = () => ({ repos: [raw('octo', 'one')], next_page: null });
  const { user } = renderPicker();
  await screen.findByText('octo/one');
  await user.type(screen.getByLabelText('Filter repositories'), 'zzz');
  expect(screen.getByText(/No repositories match/)).toBeInTheDocument();
  expect(screen.queryByText('No repositories found for this account.')).toBeNull();
});

it('shows the empty-account message and the organisation hint', async () => {
  renderPicker();
  expect(await screen.findByText('No repositories found for this account.')).toBeInTheDocument();
  expect(screen.getByText(/not authorised the Gonq OAuth App may not appear/)).toBeInTheDocument();
});

it('marks private and read-only repositories, which stay selectable', async () => {
  handlers.github_list_repos = () => ({
    repos: [raw('octo', 'secret', { private: true }), raw('octo', 'ro', { can_push: false, default_branch: 'trunk' })],
    next_page: null,
  });
  const { user, onChoose } = renderPicker();
  await screen.findByText('octo/secret');
  const [secret, ro] = rows();
  expect(within(secret).getByText('private')).toBeInTheDocument();
  expect(within(secret).queryByText('read-only for you')).toBeNull();
  expect(within(ro).getByText('read-only for you')).toBeInTheDocument();
  expect(within(ro).queryByText('private')).toBeNull();
  await user.click(within(ro).getByRole('button'));
  expect(onChoose).toHaveBeenCalledWith({ owner: 'octo', repo: 'ro', defaultBranch: 'trunk' });
});

it('shows a load error with GitHub’s message and retries from the failed page', async () => {
  let fail = true;
  handlers.github_list_repos = (a) => {
    if ((a as { page: number }).page === 1) return { repos: [raw('octo', 'one')], next_page: 2 };
    if (fail) throw { kind: 'rate_limited', message: 'API rate limit exceeded' };
    return { repos: [raw('octo', 'two')], next_page: null };
  };
  const { user } = renderPicker();
  expect(await screen.findByRole('alert')).toHaveTextContent('API rate limit exceeded');
  expect(screen.getByText('octo/one')).toBeInTheDocument();
  fail = false;
  await user.click(screen.getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('octo/two')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('reports a revoked token, also on a later page', async () => {
  handlers.github_list_repos = (a) => {
    if ((a as { page: number }).page === 1) return { repos: [raw('octo', 'one')], next_page: 2 };
    throw { kind: 'not_signed_in' };
  };
  const { onSignedOut } = renderPicker();
  await waitFor(() => expect(onSignedOut).toHaveBeenCalledTimes(1));
});

it('ignores a page that arrives after the dialog closed', async () => {
  const first = deferred();
  handlers.github_list_repos = () => first.p;
  const { onSignedOut } = renderPicker();
  await waitFor(() => expect(calls('github_list_repos')).toHaveLength(1));
  cleanup();
  await act(async () => first.reject({ kind: 'not_signed_in' }));
  expect(onSignedOut).not.toHaveBeenCalled();
  expect(calls('github_list_repos')).toHaveLength(1);
});

it('Cancel and Escape close', async () => {
  const { user, onClose } = renderPicker();
  await screen.findByText('No repositories found for this account.');
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await user.keyboard('{Escape}');
  expect(onClose).toHaveBeenCalledTimes(2);
});

// --- through the app ---

const openRepo = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Open Repo…' }));
};

it('signed in: File > Open Repo… opens the picker directly; choosing a repo closes it', async () => {
  handlers.github_list_repos = () => ({ repos: [raw('octo', 'one')], next_page: null });
  render(<App />);
  const user = userEvent.setup();
  await openRepo(user);
  expect(await screen.findByRole('dialog', { name: 'Open repository' })).toBeInTheDocument();
  expect(calls('github_start')).toHaveLength(0);
  await user.click(await screen.findByRole('button', { name: /octo\/one/ }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('signed out: runs sign-in, then opens the picker with no second click', async () => {
  let signedIn = false;
  handlers.github_status = () => (signedIn ? inn : out);
  handlers.github_poll = async () => {
    signedIn = true;
    return inn;
  };
  render(<App />);
  const user = userEvent.setup();
  await openRepo(user);
  await user.click(await screen.findByRole('button', { name: 'Start' }));
  await user.click(await screen.findByRole('button', { name: 'Done' }));
  expect(await screen.findByRole('dialog', { name: 'Open repository' })).toBeInTheDocument();
});

it('cancelling the sign-in does not open the picker', async () => {
  handlers.github_status = () => out;
  render(<App />);
  const user = userEvent.setup();
  await openRepo(user);
  const settings = await screen.findByRole('dialog', { name: 'Settings' });
  await user.click(within(settings).getAllByRole('button', { name: 'Cancel' })[0]);
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(calls('github_list_repos')).toHaveLength(0);
});

it('a revoked token closes the picker and says to sign in again', async () => {
  handlers.github_list_repos = () => {
    throw { kind: 'not_signed_in' };
  };
  render(<App />);
  await openRepo(userEvent.setup());
  expect(await screen.findByText(/no longer valid/)).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('on the web the item is present and the desktop-app error reaches the banner', async () => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  render(<App />);
  await openRepo(userEvent.setup());
  expect(await screen.findByText('Signing in to GitHub needs the Gonq desktop app')).toBeInTheDocument();
  expect(screen.queryByRole('dialog')).toBeNull();
});
