/** Covers the mobile commit sheet, the commit conflict sheet and the read-only PR banner through renderMobileApp, porting the desktop commit.test.tsx and readOnly.test.tsx: sheet content and warning, the three actions, the commit call and outcomes (success, no changes, conflict, GitHub's error), the open-PR refusals before the sheet, the read-only editor and its disabled commands, the Open PR link through openExternal and the exact opener allow-list. */
import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
const openUrl = vi.fn(async () => {});
vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }));

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { docText, editorView, select, settleEditors, type as typeText } from '@gonq/editor/testing/editor';
import { clearSessionBranches, listSessionBranches } from '@gonq/editor/features/github/sessionBranches';
import { LONG_PRESS_MS } from './EditorSheet';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

type Handler = (args: Record<string, unknown>) => unknown;
let handlers: Record<string, Handler>;
let branch = 'main';
let pulls: { branch: string; number: number }[] = [];
let pullsFail = false;
const calls = (cmd: string) => invoke.mock.calls.filter((c) => c[0] === cmd);
const MESSAGE = (n: number) => `Pull request #${n} is open for this branch. You can read this document but not change it.`;

beforeEach(() => {
  invoke.mockReset();
  openUrl.mockClear();
  clearSessionBranches();
  branch = 'main';
  pulls = [];
  pullsFail = false;
  handlers = {
    github_status: () => ({ signed_in: true, login: 'octo', storage: 'keychain' }),
    github_list_repos: () => ({
      repos: [{ owner: 'o', name: 'r', full_name: 'o/r', private: false, default_branch: branch, can_push: true, pushed_at: null }],
      next_page: null,
    }),
    github_list_branches: () => ({ default_branch: branch, branches: [branch], next_page: null }),
    github_list_folder: () => ({ entries: [{ name: 'a.md', path: 'docs/a.md', kind: 'file' }], truncated: false }),
    github_read_file: (a) => ({ path: a.path, name: 'a.md', content: '# A\n', sha: 'blob1', commit_sha: 'tip1' }),
    github_commit_file: () => ({ status: 'committed', sha: 'blob2', commit_sha: 'tip2' }),
    github_open_pulls_for_branches: (a) => {
      if (pullsFail) throw { kind: 'network', message: 'offline' };
      return (a.branches as string[]).map((b) => {
        const p = pulls.find((x) => x.branch === b);
        return { branch: b, pull: p ? { number: p.number, html_url: `https://github.com/o/r/pull/${p.number}`, draft: false, title: null } : null };
      });
    },
    recent_documents_list: () => [],
    recent_documents_add: () => [],
  };
  invoke.mockImplementation(async (cmd: string, args: Record<string, unknown>) => handlers[cmd]?.(args ?? {}));
});

/** Opens docs/a.md from the repo tree (the editor screen is then on top). */
async function openFile() {
  const r = await renderMobileApp();
  await r.user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await r.user.click(await screen.findByRole('button', { name: /o\/r/ }));
  await screen.findByRole('heading', { name: 'o/r' });
  await r.user.click(await screen.findByRole('button', { name: 'a.md' }));
  await screen.findByRole('switch', { name: 'Raw Markdown' });
  await settleEditors(document.body);
  return r;
}
const edit = (extra = '!') => {
  select(0);
  typeText(extra);
};
async function menuItem(user: User, name: RegExp) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  return screen.findByRole('menuitem', { name });
}
async function save(user: User) {
  await user.click(await menuItem(user, /^Save(?! As)/));
}
async function sheet(user: User) {
  await save(user);
  return screen.findByRole('dialog', { name: 'Commit docs/a.md?' });
}

describe('commit sheet', () => {
  it('shows File, Repository, Branch and the fixed Message; a gonq/ branch has no warning and no new-branch action', async () => {
    branch = 'gonq/fix';
    const { user } = await openFile();
    edit();
    const d = await sheet(user);
    const rows = [...d.querySelectorAll('dt')].map((e) => [e.textContent, e.nextElementSibling!.textContent]);
    expect(rows).toEqual([
      ['File', 'docs/a.md'],
      ['Repository', 'o/r'],
      ['Branch', 'gonq/fix'],
      ['Message', 'Edit docs/a.md from Gonq'],
    ]);
    expect(within(d).queryByRole('textbox')).toBeNull();
    expect(within(d).queryByText(/Author|changed|\+\d/)).toBeNull();
    expect(within(d).queryByRole('note')).toBeNull();
    expect(within(d).queryByRole('button', { name: /new branch/ })).toBeNull();
    expect(within(d).getByRole('button', { name: 'Commit' })).toHaveFocus();
  });

  it('warns on any branch that is not gonq/, with Commit (primary, focused), Commit to new branch… and Cancel', async () => {
    const { user } = await openFile();
    edit();
    const d = await sheet(user);
    const note = within(d).getByRole('note');
    expect(note).toHaveTextContent('This commits directly to main. Branch protection and review rules are GitHub’s; Gonq does not check them.');
    const buttons = within(d).getAllByRole('button');
    expect(buttons.map((b) => b.textContent)).toEqual(['Commit', 'Commit to new branch…', 'Cancel']);
    expect(buttons[0]).toHaveFocus();
    expect(buttons[0]).toHaveClass('m-tap-primary');
    for (const b of buttons) expect(b).toHaveClass('m-tap');
    expect(screen.queryByText(/Commit to main/)).toBeNull();
    await user.click(within(d).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls('github_commit_file')).toHaveLength(0);
  });

  it('the scrim cancels; Commit… from the menu opens the same sheet', async () => {
    const { user } = await openFile();
    edit();
    await user.click(await menuItem(user, /^Commit…/));
    await screen.findByRole('dialog', { name: 'Commit docs/a.md?' });
    await user.click(screen.getByTestId('commit-scrim'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(calls('github_commit_file')).toHaveLength(0);
  });

  it('Commit closes the sheet first, sends the text and sha, marks the tab clean and records the branch', async () => {
    const { user } = await openFile();
    edit();
    const d = await sheet(user);
    await user.click(within(d).getByRole('button', { name: 'Commit' }));
    expect(screen.queryByRole('dialog', { name: /Commit/ })).toBeNull();
    await waitFor(() => expect(calls('github_commit_file')).toHaveLength(1));
    expect(calls('github_commit_file')[0][1]).toEqual({ owner: 'o', repo: 'r', branch: 'main', path: 'docs/a.md', text: '!# A\n', sha: 'blob1' });
    await waitFor(() => expect(listSessionBranches()).toEqual([{ owner: 'o', repo: 'r', branch: 'main' }]));
    await save(user);
    expect(await screen.findByText('No changes to commit')).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: /Commit/ })).toBeNull();
    expect(calls('github_commit_file')).toHaveLength(1);
    edit('?');
    await user.click(within(await sheet(user)).getByRole('button', { name: 'Commit' }));
    await waitFor(() => expect(calls('github_commit_file')).toHaveLength(2));
    expect(calls('github_commit_file')[1][1]).toMatchObject({ sha: 'blob2' });
  });

  it('says there is nothing to commit, as a notice, on an unchanged document', async () => {
    const { user } = await openFile();
    await save(user);
    expect(await screen.findByRole('status')).toHaveTextContent('No changes to commit');
    expect(screen.queryByRole('dialog', { name: /Commit/ })).toBeNull();
    expect(calls('github_commit_file')).toHaveLength(0);
  });

  it("puts GitHub's own message in the error banner, not in the sheet", async () => {
    handlers.github_commit_file = () => {
      throw { kind: 'http', status: 422, message: 'Required status check is expected.' };
    };
    const { user } = await openFile();
    edit();
    await user.click(within(await sheet(user)).getByRole('button', { name: 'Commit' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Required status check is expected.');
    expect(screen.queryByRole('dialog', { name: /Commit/ })).toBeNull();
    expect(listSessionBranches()).toEqual([]);
    expect(screen.queryByText(/protected/)).toBeNull();
  });

  it('Commit to new branch… continues into Create branch, which also commits the change', async () => {
    handlers.github_branch_exists = () => false;
    handlers.github_create_branch = () => undefined;
    const { user } = await openFile();
    edit();
    await user.click(within(await sheet(user)).getByRole('button', { name: 'Commit to new branch…' }));
    const create = await screen.findByRole('dialog', { name: 'Create branch' });
    await user.type(within(create).getByRole('textbox', { name: 'Branch name' }), 'fix');
    await user.click(within(create).getByRole('button', { name: 'Create' }));
    await waitFor(() => expect(calls('github_commit_file')).toHaveLength(1));
    expect(calls('github_commit_file')[0][1]).toMatchObject({ branch: 'gonq/fix', text: '!# A\n' });
  });
});

describe('commit conflict', () => {
  it('shows the real conflict sheet, writes nothing and leaves the tab unsaved for either answer', async () => {
    handlers.github_commit_file = () => ({ status: 'conflict' });
    const { user } = await openFile();
    edit();
    await user.click(within(await sheet(user)).getByRole('button', { name: 'Commit' }));
    const d = await screen.findByRole('dialog', { name: 'a.md changed on the server since you opened it.' });
    expect(d).toHaveTextContent('Overwrite replaces the server’s version with yours. Cancel keeps your changes unsaved.');
    expect(within(d).getByRole('button', { name: 'Cancel' })).toHaveFocus();
    expect(within(d).getByRole('button', { name: 'Overwrite' })).toHaveClass('m-destructive');
    expect(screen.queryByText(/changed on disk/)).toBeNull();
    await user.click(within(d).getByRole('button', { name: 'Overwrite' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(listSessionBranches()).toEqual([]);
    // Still unsaved: Save asks again with the old sha.
    await user.click(within(await sheet(user)).getByRole('button', { name: 'Commit' }));
    await screen.findByRole('dialog', { name: /changed on the server/ });
    expect(calls('github_commit_file')).toHaveLength(2);
    expect(calls('github_commit_file')[1][1]).toMatchObject({ sha: 'blob1' });
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(docText()).toBe('!# A\n');
  });
});

describe('open pull request', () => {
  it('refuses Save and Commit… before the sheet with the banner words and writes nothing', async () => {
    pulls = [{ branch: 'main', number: 12 }];
    const { user } = await openFile();
    const b = await screen.findByTestId('read-only-banner');
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGE(12));
    expect(screen.queryByRole('dialog', { name: /Commit/ })).toBeNull();
    expect(calls('github_commit_file')).toHaveLength(0);
    expect(b).toHaveTextContent(MESSAGE(12));
  });

  it('fails closed with its own message when the check cannot complete', async () => {
    const { user } = await openFile();
    edit();
    pullsFail = true;
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not check for an open pull request; try again.');
    expect(screen.queryByRole('dialog', { name: /Commit/ })).toBeNull();
    expect(calls('github_commit_file')).toHaveLength(0);
  });

  it('a PR opened meanwhile refuses the commit and turns the tab read-only', async () => {
    const { user } = await openFile();
    edit();
    pulls = [{ branch: 'main', number: 9 }];
    await save(user);
    expect(await screen.findByRole('alert')).toHaveTextContent(MESSAGE(9));
    expect(await screen.findByTestId('read-only-banner')).toBeInTheDocument();
    expect(editorView().state.readOnly).toBe(true);
    expect(calls('github_commit_file')).toHaveLength(0);
  });

  it('the tab is read-only: banner with an Open PR link through openExternal, Add Comment and Commit… disabled, Raw still switches', async () => {
    pulls = [{ branch: 'main', number: 12 }];
    const { user } = await openFile();
    const b = await screen.findByTestId('read-only-banner');
    await waitFor(() => expect(editorView().state.readOnly).toBe(true));
    expect(editorView().contentDOM.getAttribute('contenteditable')).toBe('false');
    const link = within(b).getByRole('link', { name: 'Open PR' });
    expect(link).toHaveAttribute('href', 'https://github.com/o/r/pull/12');
    expect(link).toHaveClass('m-tap');
    await user.click(link);
    await waitFor(() => expect(openUrl).toHaveBeenCalledWith('https://github.com/o/r/pull/12'));
    expect(await menuItem(user, /^Commit…/)).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Close sheet' }));
    // Add Comment is disabled in the long-press sheet.
    const content = document.querySelector<HTMLElement>('.cm-content')!;
    const down = createEvent('pointerdown', content, { bubbles: true, cancelable: true });
    Object.defineProperties(down, { pointerType: { value: 'touch' }, isPrimary: { value: true }, clientX: { value: 10 }, clientY: { value: 10 } });
    fireEvent(content, down);
    await new Promise((r) => setTimeout(r, LONG_PRESS_MS + 100));
    const editorSheet = await screen.findByRole('dialog', { name: 'Editor' });
    expect(within(editorSheet).getByRole('menuitem', { name: /^Add Comment/ })).toBeDisabled();
    await user.click(within(editorSheet).getByRole('button', { name: 'Close' }));
    await user.click(screen.getByRole('switch', { name: 'Raw Markdown' }));
    expect(screen.getByRole('switch', { name: 'Raw Markdown' })).toBeChecked();
    expect(screen.getByTestId('read-only-banner')).toBeInTheDocument();
  });

  it('shows no banner and stays editable when the check fails (offline)', async () => {
    pullsFail = true;
    await openFile();
    await waitFor(() => expect(calls('github_open_pulls_for_branches').length).toBeGreaterThan(0));
    expect(screen.queryByTestId('read-only-banner')).toBeNull();
    expect(editorView().state.readOnly).toBe(false);
  });

  // Observation (M-22 criterion 5): no Format command or formatting-bar button has a read-only rule, on desktop or mobile;
  // they stay enabled. What they do is the shared editor handle's: format() returns early while the view is read-only
  // (MarkdownEditor.tsx), so on both apps Bold on a read-only tab is a no-op. Mobile therefore behaves as desktop.
  it('Bold stays enabled on a read-only tab and changes nothing (the shared handle ignores it, as on desktop)', async () => {
    pulls = [{ branch: 'main', number: 12 }];
    const { user } = await openFile();
    await screen.findByTestId('read-only-banner');
    await waitFor(() => expect(editorView().state.readOnly).toBe(true));
    select(2, 3);
    const bold = screen.getByRole('button', { name: /^Bold/ });
    expect(bold).toBeEnabled();
    await user.click(bold);
    expect(docText()).toBe('# A\n');
  });
});

it('keeps the mobile opener allow-list at exactly three entries', () => {
  const cap = JSON.parse(readFileSync(join(process.cwd(), 'src-tauri/capabilities/mobile.json'), 'utf8'));
  const opener = cap.permissions.find((p: unknown) => typeof p === 'object' && (p as { identifier: string }).identifier === 'opener:allow-open-url');
  expect(opener.allow).toEqual([{ url: 'https://github.com/crashtest00/gonq' }, { url: 'https://github.com/login/device' }, { url: 'https://github.com/*/pull/*' }]);
});
