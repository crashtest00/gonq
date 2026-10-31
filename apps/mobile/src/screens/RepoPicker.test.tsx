/** Covers the mobile repo picker through renderMobileApp, porting desktop RepoPicker.test.tsx: paged loading, client-side filter, badges, empty/no-match texts and the organisations note, error with Retry, revoked token notice, Cancel/Back, picking opens the tree on the default branch, and the signed-out and cancelled-sign-in routes. */
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { renderMobileApp } from '../testing/renderMobileApp';

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
  invoke.mockReset();
  handlers = {
    github_status: () => inn,
    github_start: () => ({ user_code: 'ABCD-1234', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 }),
    github_poll: () => new Promise(() => {}),
    github_list_repos: () => ({ repos: [], next_page: null }),
    github_list_branches: () => ({ default_branch: 'main', branches: ['main'], next_page: null }),
    github_list_folder: () => ({ entries: [], truncated: false }),
    recent_documents_list: () => [],
  };
  invoke.mockImplementation(async (cmd: string, args: unknown) => {
    const h = handlers[cmd];
    if (!h) return undefined;
    return h(args);
  });
});

function deferred() {
  let resolve!: (v: unknown) => void;
  let reject!: (e: unknown) => void;
  const p = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { p, resolve, reject };
}

const rows = () => within(screen.getByRole('list', { name: 'Repositories' })).queryAllByRole('listitem');

async function openPicker() {
  const r = await renderMobileApp();
  await r.user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await screen.findByRole('heading', { name: 'Open repository' });
  return r;
}

it('loads pages in order, shows rows as each arrives, and a loading line until the last', async () => {
  const second = deferred();
  handlers.github_list_repos = (a) => ((a as { page: number }).page === 1 ? { repos: [raw('octo', 'one')], next_page: 2 } : second.p);
  await openPicker();
  expect(await screen.findByText('octo/one')).toBeInTheDocument();
  await waitFor(() => expect(calls('github_list_repos').map((c) => c[1])).toEqual([{ page: 1 }, { page: 2 }]));
  expect(screen.getByText('Loading more…')).toBeInTheDocument();
  await act(async () => second.resolve({ repos: [raw('acme', 'two')], next_page: null }));
  expect(await screen.findByText('acme/two')).toBeInTheDocument();
  expect(rows()).toHaveLength(2);
  expect(screen.queryByText('Loading more…')).toBeNull();
});

it('filters case-insensitively on owner/repo without refetching, with the desktop placeholder and no count', async () => {
  handlers.github_list_repos = () => ({ repos: [raw('Octo', 'Alpha'), raw('acme', 'beta'), raw('acme', 'OCTOpus')], next_page: null });
  const { user } = await openPicker();
  await screen.findByText('Octo/Alpha');
  const box = screen.getByPlaceholderText('Filter by owner/repo');
  await user.type(box, 'oCTO');
  expect(rows().map((r) => r.textContent)).toEqual(['Octo/Alpha', 'acme/OCTOpus']);
  await user.clear(box);
  await user.type(box, 'acme/b');
  expect(rows().map((r) => r.textContent)).toEqual(['acme/beta']);
  expect(calls('github_list_repos')).toHaveLength(1);
  expect(screen.queryByText(/\b\d+ repositories\b/)).toBeNull();
});

it('says so when the filter matches nothing, with no hint line and no Clear filter button', async () => {
  handlers.github_list_repos = () => ({ repos: [raw('octo', 'one')], next_page: null });
  const { user } = await openPicker();
  await screen.findByText('octo/one');
  await user.type(screen.getByLabelText('Filter repositories'), ' zzz ');
  expect(screen.getByText('No repositories match “zzz”.')).toBeInTheDocument();
  expect(screen.queryByText('No repositories found for this account.')).toBeNull();
  expect(screen.queryByRole('button', { name: /clear filter/i })).toBeNull();
});

it('shows the empty-account text, the organisations note and Cancel', async () => {
  await openPicker();
  expect(await screen.findByText('No repositories found for this account.')).toBeInTheDocument();
  expect(screen.getByText('Repositories from organisations that have not authorised the Gonq OAuth App may not appear here.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
});

it('marks private and read-only repositories (no description, no time), which stay selectable', async () => {
  handlers.github_list_repos = () => ({
    repos: [raw('octo', 'secret', { private: true, description: 'hidden', pushed_at: '2026-01-01T00:00:00Z' }), raw('octo', 'ro', { can_push: false, default_branch: 'trunk' })],
    next_page: null,
  });
  const { user } = await openPicker();
  await screen.findByText('octo/secret');
  const [secret, ro] = rows();
  expect(secret).toHaveTextContent('octo/secretprivate');
  expect(within(secret).queryByText('read-only for you')).toBeNull();
  expect(ro).toHaveTextContent('octo/roread-only for you');
  expect(within(ro).queryByText('private')).toBeNull();
  await user.click(within(ro).getByRole('button'));
  // The tree opens on the repo's default branch (trunk) and the picker is gone.
  expect(await screen.findByRole('heading', { name: 'octo/ro' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Branch: trunk' })).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Open repository' })).toBeNull();
  expect(calls('github_list_folder')[0][1]).toMatchObject({ owner: 'octo', repo: 'ro', branch: 'trunk', path: '' });
});

it('shows a load error with GitHub’s message and retries from the failed page', async () => {
  let fail = true;
  handlers.github_list_repos = (a) => {
    if ((a as { page: number }).page === 1) return { repos: [raw('octo', 'one')], next_page: 2 };
    if (fail) throw { kind: 'rate_limited', message: 'API rate limit exceeded' };
    return { repos: [raw('octo', 'two')], next_page: null };
  };
  const { user } = await openPicker();
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('API rate limit exceeded');
  expect(screen.getByText('octo/one')).toBeInTheDocument();
  fail = false;
  await user.click(within(alert).getByRole('button', { name: 'Retry' }));
  expect(await screen.findByText('octo/two')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).toBeNull();
});

it('a revoked token closes the picker and shows the sign-in-again notice in the banner', async () => {
  handlers.github_list_repos = () => {
    throw { kind: 'not_signed_in' };
  };
  await renderMobileApp().then(async (r) => r.user.click(screen.getByRole('button', { name: 'Open Repo…' })));
  expect(await screen.findByText('GitHub sign-in is no longer valid. Sign in again to open a repository.')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Open repository' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
});

it('Cancel and the Back button close the picker', async () => {
  const { user } = await openPicker();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await screen.findByRole('heading', { name: 'Open repository' });
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
  expect(calls('github_list_folder')).toHaveLength(0);
});

it('ignores a page that arrives after the picker closed', async () => {
  const first = deferred();
  handlers.github_list_repos = () => first.p;
  const { user } = await openPicker();
  await waitFor(() => expect(calls('github_list_repos')).toHaveLength(1));
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  await act(async () => first.reject({ kind: 'not_signed_in' }));
  expect(screen.queryByText(/no longer valid/)).toBeNull();
});

it('signed out: runs sign-in, then opens the picker with no second tap', async () => {
  let signedIn = false;
  handlers.github_status = () => (signedIn ? inn : out);
  handlers.github_poll = async () => {
    signedIn = true;
    return inn;
  };
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await user.click(await screen.findByRole('button', { name: 'Start' }));
  await user.click(await screen.findByRole('button', { name: 'Done' }));
  expect(await screen.findByRole('heading', { name: 'Open repository' })).toBeInTheDocument();
});

it('cancelling the sign-in does not open the picker', async () => {
  handlers.github_status = () => out;
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await screen.findByRole('button', { name: 'Start' });
  await user.click(screen.getByRole('button', { name: 'Back' }));
  expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
  expect(calls('github_list_repos')).toHaveLength(0);
});
