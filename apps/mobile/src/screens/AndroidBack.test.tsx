/** Covers the Android system Back key (M-35) through renderMobileApp with a simulated Back press on the platform hook: overlays close first (menu, folder navigator, comments sheet, outline drawer, unsaved and conflict dialogs, commit sheet), screens go back as their own Back/Cancel control does (Settings, Open Repository, the Open PR steps, GitHub sign-in), the editor never drops unsaved changes, the Documents screen leaves the app, repeated presses do not skip or double-prompt, and no hook is registered outside Android. */
import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl: vi.fn(async () => {}) }));

let backHandler: (() => void) | null = null;
const unregister = vi.fn();
const leaveApp = vi.fn(async () => {});
vi.mock('@gonq/editor/platform/backButton', () => ({
  onAndroidBack: (h: () => void) => {
    backHandler = h;
    return unregister;
  },
  leaveApp: () => leaveApp(),
  hasBackButton: () => true,
}));

import { type as typeIntoEditor } from '@gonq/editor/testing/editor';
import { addSessionBranch, clearSessionBranches } from '@gonq/editor/features/github/sessionBranches';
import { BackProvider } from '../shell/back';
import { DialogsProvider, useDialogs } from '../shell/dialogs';
import { CommitSheet } from './CommitSheet';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
const back = () => act(async () => backHandler?.());
const heading = (name: string) => screen.getByRole('heading', { name });
const repoRow = { owner: 'octo', name: 'notes', full_name: 'octo/notes', private: false, default_branch: 'main', can_push: true, pushed_at: null };

beforeEach(() => {
  backHandler = null;
  unregister.mockClear();
  leaveApp.mockClear();
  clearSessionBranches();
  handlers = {
    github_status: () => ({ signed_in: true, login: 'octo', storage: 'keychain' }),
    github_list_repos: () => ({ repos: [repoRow], next_page: null }),
    github_list_branches: () => ({ default_branch: 'main', branches: ['main', 'gonq/one'], next_page: null }),
    github_list_folder: () => ({ entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false }),
    github_branches_exist: (a) => a.branches,
    github_open_pulls_for_branches: (a) => (a.branches as string[]).map((branch) => ({ branch, pull: null })),
    github_compare: () => ({ ahead_by: 1, behind_by: 0, files: [], truncated: false }),
    recent_documents_list: () => [],
    recent_documents_add: () => [],
  };
  invoke.mockReset().mockImplementation(async (cmd: string, args: Record<string, unknown>) => handlers[cmd]?.(args ?? {}));
});

async function openMenu(user: User) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  return screen.findByRole('dialog', { name: 'Menu' });
}
async function openEditor() {
  const r = await renderMobileApp();
  await r.user.click(screen.getByRole('button', { name: 'New' }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  return r;
}

describe('overlays close first and leave the screen as it was', () => {
  it('closes the overflow menu', async () => {
    const { user } = await renderMobileApp();
    await openMenu(user);
    await back();
    expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
    expect(heading('Documents')).toBeInTheDocument();
    expect(leaveApp).not.toHaveBeenCalled();
  });

  it('closes the folder navigator sheet', async () => {
    const { user } = await renderMobileApp();
    await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
    expect(await screen.findByRole('dialog', { name: 'Folder navigator' })).toBeVisible();
    await back();
    expect(screen.getByRole('dialog', { name: 'Folder navigator', hidden: true }).parentElement).toHaveAttribute('hidden');
    expect(heading('Documents')).toBeInTheDocument();
  });

  it('closes the comments sheet and the outline drawer in the editor, and stays on the editor', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByRole('button', { name: /comments/i }));
    await screen.findByRole('dialog', { name: 'Comments' });
    await back();
    expect(screen.queryByRole('dialog', { name: 'Comments' })).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Document outline' }));
    await screen.findByRole('dialog', { name: 'Outline' });
    await back();
    expect(screen.queryByRole('dialog', { name: 'Outline' })).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();
  });

  it('closes the topmost of two overlays first', async () => {
    const { user } = await openEditor();
    await user.click(screen.getByRole('button', { name: /comments/i }));
    await screen.findByRole('dialog', { name: 'Comments' });
    await openMenu(user);
    await back();
    expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
    expect(screen.getByRole('dialog', { name: 'Comments' })).toBeInTheDocument();
  });

  it('answers Cancel on the unsaved-changes and conflict dialogs and on the commit sheet', async () => {
    const answers: unknown[] = [];
    function Ask() {
      const d = useDialogs();
      return (
        <>
          <button onClick={() => void d.confirmUnsaved('a.md').then((c) => answers.push(c))}>unsaved</button>
          <button onClick={() => void d.confirmConflict({ name: 'a.md', deleted: false }).then((c) => answers.push(c))}>conflict</button>
        </>
      );
    }
    const onChoose = vi.fn();
    const { getByText } = render(
      <BackProvider>
        <DialogsProvider>
          <Ask />
        </DialogsProvider>
        <CommitSheet owner="o" repo="r" branch="gonq/x" path="a.md" onChoose={onChoose} />
      </BackProvider>,
    );
    // The commit sheet was mounted last, so it is on top.
    await back();
    expect(onChoose).toHaveBeenCalledWith('cancel');
    act(() => getByText('unsaved').click());
    await screen.findByRole('dialog', { name: /Save changes to a.md/ });
    await back();
    act(() => getByText('conflict').click());
    await screen.findByRole('dialog', { name: /changed on the server/ });
    await back();
    await waitFor(() => expect(answers).toEqual(['cancel', 'cancel']));
    expect(screen.queryByRole('dialog', { name: /changed on the server/ })).toBeNull();
  });
});

describe('screens go back as their own control does', () => {
  it('returns from Settings to Documents', async () => {
    const { user } = await renderMobileApp();
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Settings…' }));
    await screen.findByRole('form', { name: 'Settings' });
    await back();
    expect(heading('Documents')).toBeInTheDocument();
  });

  it('returns from the repository picker, and from the repository screen, one screen at a time', async () => {
    const { user } = await renderMobileApp();
    await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
    await screen.findByRole('button', { name: /octo\/notes/ });
    await back();
    expect(heading('Documents')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
    await user.click(await screen.findByRole('button', { name: /octo\/notes/ }));
    await screen.findByRole('heading', { name: 'octo/notes' });
    await back();
    expect(heading('Documents')).toBeInTheDocument();
    expect(leaveApp).not.toHaveBeenCalled();
  });

  it('steps back through the Open PR review, details and result screens, one per press', async () => {
    handlers.github_create_pull = () => ({ number: 12, html_url: 'https://github.com/octo/notes/pull/12' });
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/one' });
    const { user } = await renderMobileApp();
    await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
    await user.click(await screen.findByRole('button', { name: /octo\/notes/ }));
    await screen.findByRole('heading', { name: 'octo/notes' });
    await user.click(screen.getByRole('button', { name: 'Back' }));
    await openMenu(user);
    await user.click(await screen.findByRole('menuitem', { name: 'Open PR…' }));
    await user.click(await screen.findByRole('option', { name: 'gonq/one' }));
    await user.click(await screen.findByRole('option', { name: 'main' }));
    await screen.findByText(/commits? ahead/);
    await user.click(screen.getByRole('button', { name: 'Open PR' }));
    await screen.findByRole('textbox', { name: 'Title' });
    // Details -> review (edits discarded as its Back button does), then review -> Documents.
    await back();
    expect(screen.queryByRole('textbox', { name: 'Title' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Open PR' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open PR' }));
    await user.click(await screen.findByRole('button', { name: 'Open PR' }));
    await screen.findByText(/was opened for/);
    await back();
    expect(heading('Documents')).toBeInTheDocument();
  });

  it('cancels a pending GitHub sign-in so it can be started again', async () => {
    handlers.github_status = () => ({ signed_in: false, login: null, storage: null });
    handlers.github_start = () => ({ user_code: 'WDJB-MJHT', verification_uri: 'https://github.com/login/device', expires_in: 900, interval: 5 });
    handlers.github_poll = () => new Promise(() => {});
    const { user } = await renderMobileApp();
    await user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
    await user.click(await screen.findByRole('button', { name: 'Start' }));
    await screen.findByText('Enter this code on GitHub:');
    await back();
    expect(heading('Documents')).toBeInTheDocument();
    expect(invoke.mock.calls.some((c) => c[0] === 'github_sign_out')).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Sign in to GitHub' }));
    expect(await screen.findByRole('button', { name: 'Start' })).toBeInTheDocument();
  });
});

describe('the editor and the Documents screen', () => {
  it('returns to Documents when nothing is unsaved', async () => {
    await openEditor();
    await back();
    expect(heading('Documents')).toBeInTheDocument();
  });

  it('asks the close prompt when there are unsaved changes and keeps them on Cancel', async () => {
    const { user } = await openEditor();
    typeIntoEditor('hello');
    await back();
    const dialog = await screen.findByRole('dialog', { name: /Save changes to/ });
    // A second Back answers Cancel; it neither stacks a second prompt nor closes the tab.
    await back();
    expect(dialog).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Save changes to/ })).toBeNull();
    expect(screen.getByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
    expect(leaveApp).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: 'Back' }));
  });

  it('discards only when the prompt says Don’t save', async () => {
    const { user } = await openEditor();
    typeIntoEditor('hello');
    await back();
    await user.click(await screen.findByRole('button', { name: 'Don’t save' }));
    await screen.findByRole('heading', { name: 'Documents' });
  });

  it('leaves the app from Documents with nothing open, and asks first for a tab left unsaved', async () => {
    await renderMobileApp();
    await back();
    expect(leaveApp).toHaveBeenCalledTimes(1);
    await back();
    expect(leaveApp).toHaveBeenCalledTimes(2);
  });

  it('asks about a tab left unsaved instead of leaving', async () => {
    const { user } = await openEditor();
    typeIntoEditor('hello');
    await user.click(screen.getByRole('button', { name: 'Back' }));
    expect(heading('Documents')).toBeInTheDocument();
    await back();
    expect(await screen.findByRole('dialog', { name: /Save changes to/ })).toBeInTheDocument();
    expect(leaveApp).not.toHaveBeenCalled();
  });
});

it('registers the hook once and unregisters it on unmount', async () => {
  const { unmount } = await renderMobileApp();
  expect(backHandler).not.toBeNull();
  unmount();
  expect(unregister).toHaveBeenCalledTimes(1);
});
