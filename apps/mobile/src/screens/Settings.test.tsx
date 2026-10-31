/** Covers the mobile Settings screen through renderMobileApp, porting desktop Settings.test.tsx and the GitHub row: default name, Cancel, trimmed save, refused names, backend failure in the hint line, GitHub row states, no theme/SSH/pane rows. */
import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { AUTHOR_KEY } from '@gonq/editor/platform/settings';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

let status: unknown;
let authorFails: string | null;

function native() {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
}

beforeEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  localStorage.clear();
  status = { signed_in: false, login: null, storage: null };
  authorFails = null;
  invoke.mockReset().mockImplementation((cmd: string, args: { name?: string }) => {
    if (cmd === 'github_status') return Promise.resolve(status);
    if (cmd === 'github_sign_out') {
      status = { signed_in: false, login: null, storage: null };
      return Promise.resolve();
    }
    if (cmd === 'get_author_name') return Promise.resolve('Ann');
    if (cmd === 'set_author_name') return authorFails ? Promise.reject(authorFails) : Promise.resolve(args.name);
    return Promise.resolve(null);
  });
});

async function openSettings(user: User) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Settings…' }));
  return screen.findByRole('form', { name: 'Settings' });
}

it('opens from the ⋯ menu with the default name, hint and placeholder; Cancel returns to Documents', async () => {
  const { user } = await renderMobileApp();
  const f = await openSettings(user);
  const input = within(f).getByLabelText('Author name');
  expect(input).toHaveValue('User');
  expect(input).toHaveAttribute('placeholder', 'User');
  expect(within(f).getByText('Written on the comments and replies you add.')).toBeInTheDocument();
  await user.click(within(f).getByRole('button', { name: 'Cancel' }));
  expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
});

it('has only the author name and GitHub: no theme, SSH keys or pane widths', async () => {
  const { user } = await renderMobileApp();
  const f = await openSettings(user);
  expect(within(f).getAllByRole('heading').map((h) => h.textContent)).toEqual(['GitHub']);
  expect(f.textContent).not.toMatch(/theme|ssh|pane|width/i);
});

it('saving stores the trimmed name and a reopened screen shows it', async () => {
  const { user } = await renderMobileApp();
  let f = await openSettings(user);
  const input = within(f).getByLabelText('Author name');
  await user.clear(input);
  await user.type(input, '  Ann Lee  ');
  await user.click(within(f).getByRole('button', { name: 'Save' }));
  expect(screen.getByRole('heading', { name: 'Documents' })).toBeInTheDocument();
  expect(localStorage.getItem(AUTHOR_KEY)).toBe('Ann Lee');
  f = await openSettings(user);
  await vi.waitFor(() => expect(within(f).getByLabelText('Author name')).toHaveValue('Ann Lee'));
});

it.each([
  ['blank', '', 'Enter a name.'],
  ['whitespace only', '   ', 'Enter a name.'],
  ['a pipe', 'a|b', 'The name cannot contain "|", "]" or line breaks.'],
  ['a closing bracket', 'a]b', 'The name cannot contain "|", "]" or line breaks.'],
  ['101 characters', 'x'.repeat(101), 'Use at most 100 characters.'],
])('%s is refused with the hint-line alert, Save disabled, nothing stored', async (_l, bad, message) => {
  const { user } = await renderMobileApp();
  const f = await openSettings(user);
  const input = within(f).getByLabelText('Author name');
  await user.clear(input);
  if (bad !== '') {
    await user.click(input);
    await user.paste(bad);
  }
  expect(within(f).getByRole('alert')).toHaveTextContent(message);
  expect(within(f).getByRole('button', { name: 'Save' })).toBeDisabled();
  expect(screen.queryByRole('heading', { name: 'Documents' })).toBeNull();
  expect(localStorage.getItem(AUTHOR_KEY)).toBeNull();
});

it('a backend failure shows in the same line and the screen stays', async () => {
  native();
  authorFails = 'settings.json is read-only';
  const { user } = await renderMobileApp();
  const f = await openSettings(user);
  await vi.waitFor(() => expect(within(f).getByLabelText('Author name')).toHaveValue('Ann'));
  await user.type(within(f).getByLabelText('Author name'), 'x');
  await user.click(within(f).getByRole('button', { name: 'Save' }));
  expect(await within(f).findByRole('alert')).toHaveTextContent('settings.json is read-only');
  expect(within(f).getByRole('button', { name: 'Save' })).toBeEnabled();
});

it('GitHub row: Checking…, then Not signed in. with Sign In, which opens the sign-in screen', async () => {
  native();
  let release: () => void = () => {};
  const gate = new Promise<void>((r) => (release = r));
  const answer = invoke.getMockImplementation()!;
  invoke.mockImplementation((cmd: string, a: never) => (cmd === 'github_status' ? gate.then(() => status) : answer(cmd, a)));
  const { user } = await renderMobileApp();
  const f = await openSettings(user);
  expect(within(f).getByRole('status')).toHaveTextContent('Checking…');
  release();
  expect(await within(f).findByText('Not signed in.')).toBeInTheDocument();
  await user.click(within(f).getByRole('button', { name: 'Sign In' }));
  expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
});

it('GitHub row: Signed in as <login>. with Sign Out, which signs out', async () => {
  native();
  status = { signed_in: true, login: 'octo', storage: 'keychain' };
  const { user } = await renderMobileApp();
  const f = await openSettings(user);
  expect(await within(f).findByText('Signed in as octo.')).toBeInTheDocument();
  await user.click(within(f).getByRole('button', { name: 'Sign Out' }));
  expect(await within(f).findByText('Not signed in.')).toBeInTheDocument();
  expect(invoke).toHaveBeenCalledWith('github_sign_out', undefined);
});

it('GitHub row: Signed in. without a login', async () => {
  native();
  status = { signed_in: true, login: null, storage: 'keychain' };
  const { user } = await renderMobileApp();
  const f = await openSettings(user);
  expect(await within(f).findByText('Signed in.')).toBeInTheDocument();
});

it('GitHub row on mobile web names the Gonq app', async () => {
  const { user } = await renderMobileApp();
  const f = await openSettings(user);
  expect(await within(f).findByText('GitHub sign-in needs the Gonq app.')).toBeInTheDocument();
  expect(within(f).getByRole('button', { name: 'Sign In' })).toBeEnabled();
});
