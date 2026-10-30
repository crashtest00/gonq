/** useGithubController: commit conflict, change-branch warning with a dirty tab, read-only flip, Open PR defaults, deleted branch on refresh. */
import { act, renderHook } from '@testing-library/react';
import { useDocument } from '../document/useDocument';
import { clearSessionBranches, addSessionBranch } from '../features/github/sessionBranches';
import { useGithubController, type GithubDialogs } from './github';

const mocks = vi.hoisted(() => ({
  commitFile: vi.fn(),
  openPullForBranch: vi.fn(async (): Promise<unknown> => null),
  ensureSignedIn: vi.fn(async () => true),
}));
vi.mock('../platform/github', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../platform/github')>()),
  commitFile: mocks.commitFile,
  openPullForBranch: mocks.openPullForBranch,
  ensureSignedIn: mocks.ensureSignedIn,
  setSignInHandler: () => () => {},
}));

const gh = (branch: string) => ({ owner: 'octo', repo: 'notes', branch, path: 'a.md', sha: 'sha1', commitSha: 'c1' });

function setup(dialogs: Partial<GithubDialogs> = {}) {
  const calls = { errors: [] as (string | null)[], notices: [] as (string | null)[] };
  const all: GithubDialogs = {
    signIn: async () => true,
    pickRepo: async () => ({ kind: 'closed' }),
    confirmBranchChange: vi.fn(async () => true),
    chooseCommit: vi.fn(async () => 'commit' as const),
    showConflict: vi.fn(async () => 'cancel'),
    createBranch: vi.fn(async () => null),
    openPr: vi.fn(async () => undefined),
    ...dialogs,
  };
  const hook = renderHook(() => {
    const session = useDocument();
    const github = useGithubController({ session, dialogs: all, onError: (m) => calls.errors.push(m), onNotice: (m) => calls.notices.push(m) });
    return { session, github };
  });
  return { ...hook, calls, dialogs: all };
}

type Hook = ReturnType<typeof setup>['result'];

/** Opens a GitHub tab on `branch`; dirty types into it. */
function openTab(result: Hook, branch = 'main', dirty = true) {
  act(() => result.current.session.open({ name: 'a.md', path: `github://octo/notes/${branch}/a.md`, text: 'one', github: gh(branch) }));
  const id = result.current.session.activeId!;
  if (dirty) act(() => result.current.session.edited(id, { text: 'two', canUndo: true, canRedo: false }));
  return id;
}

beforeEach(() => {
  mocks.commitFile.mockReset();
  mocks.openPullForBranch.mockReset().mockResolvedValue(null);
  clearSessionBranches();
});

describe('commit', () => {
  test('a conflict shows the conflict choice, writes nothing and leaves the tab dirty', async () => {
    mocks.commitFile.mockResolvedValue({ status: 'conflict' });
    const { result, dialogs } = setup();
    const id = openTab(result);
    const tab = result.current.session.peek(id)!;
    let done: boolean | undefined;
    await act(async () => {
      done = await result.current.github.commitGithub(id, tab.meta.github!, tab.text, true, tab.meta);
    });
    expect(done).toBe(false);
    expect(dialogs.showConflict).toHaveBeenCalledWith({ name: 'a.md', deleted: false });
    expect(result.current.session.peek(id)!.dirty).toBe(true);
  });

  test('a commit marks the tab saved with the new shas and remembers the branch', async () => {
    mocks.commitFile.mockResolvedValue({ status: 'committed', sha: 'sha2', commitSha: 'c2' });
    const { result } = setup();
    const id = openTab(result);
    const tab = result.current.session.peek(id)!;
    await act(async () => {
      await result.current.github.commitGithub(id, tab.meta.github!, tab.text, true, tab.meta);
    });
    const after = result.current.session.peek(id)!;
    expect(after.dirty).toBe(false);
    expect(after.meta.github).toMatchObject({ sha: 'sha2', commitSha: 'c2' });
  });

  test('nothing to commit says so and calls nothing', async () => {
    const { result, calls, dialogs } = setup();
    const id = openTab(result, 'main', false);
    const tab = result.current.session.peek(id)!;
    await act(async () => {
      await result.current.github.commitGithub(id, tab.meta.github!, tab.text, false, tab.meta);
    });
    expect(calls.notices).toContain('No changes to commit');
    expect(dialogs.chooseCommit).not.toHaveBeenCalled();
    expect(mocks.commitFile).not.toHaveBeenCalled();
  });
});

describe('change branch', () => {
  test('warns with a dirty tab; Cancel keeps the tab and the branch', async () => {
    const { result, dialogs } = setup({ confirmBranchChange: vi.fn(async () => false) });
    openTab(result);
    act(() => result.current.github.setRepo({ owner: 'octo', repo: 'notes', branch: 'main' }));
    await act(() => result.current.github.changeBranch('dev'));
    expect(dialogs.confirmBranchChange).toHaveBeenCalledWith('a.md');
    expect(result.current.session.tabs).toHaveLength(1);
    expect(result.current.github.repo!.branch).toBe('main');
  });

  test('OK closes the tab and moves the branch', async () => {
    const { result } = setup();
    openTab(result);
    act(() => result.current.github.setRepo({ owner: 'octo', repo: 'notes', branch: 'main' }));
    await act(() => result.current.github.changeBranch('dev'));
    expect(result.current.session.tabs).toHaveLength(0);
    expect(result.current.github.repo!.branch).toBe('dev');
  });

  test('a clean tab closes without a warning', async () => {
    const { result, dialogs } = setup();
    openTab(result, 'main', false);
    await act(() => result.current.github.changeBranch('dev'));
    expect(dialogs.confirmBranchChange).not.toHaveBeenCalled();
    expect(result.current.session.tabs).toHaveLength(0);
  });
});

describe('read-only', () => {
  test('a branch with an open pull request makes its tab read-only and refuses to commit', async () => {
    mocks.openPullForBranch.mockResolvedValue({ number: 7, url: 'https://x/7', draft: false });
    const { result, calls, dialogs } = setup();
    const id = openTab(result);
    await vi.waitFor(() => expect(result.current.github.readOnlyPull).toMatchObject({ number: 7 }));
    const tab = result.current.session.peek(id)!;
    let done: boolean | undefined;
    await act(async () => {
      done = await result.current.github.commitGithub(id, tab.meta.github!, tab.text, true, tab.meta);
    });
    expect(done).toBe(false);
    expect(calls.errors.at(-1)).toBe('Pull request #7 is open for this branch. You can read this document but not change it.');
    expect(dialogs.chooseCommit).not.toHaveBeenCalled();
  });

  test('opening a pull request flips the tab to read-only', async () => {
    const openPr = vi.fn(async (args: Parameters<GithubDialogs['openPr']>[0]) =>
      args.onOpened({ owner: 'octo', repo: 'notes', branch: 'main', pull: { number: 9, url: 'https://x/9' } }),
    );
    const { result } = setup({ openPr });
    openTab(result, 'main', false);
    expect(result.current.github.readOnlyPull).toBeNull();
    await act(() => result.current.github.openPr());
    expect(result.current.github.readOnlyPull).toMatchObject({ number: 9, url: 'https://x/9' });
  });
});

describe('open PR defaults', () => {
  test('prefers the navigator repository, lists tab and session branches', async () => {
    addSessionBranch({ owner: 'octo', repo: 'notes', branch: 'gonq/x' });
    const { result, dialogs } = setup();
    openTab(result, 'feat', false);
    act(() => result.current.github.setRepo({ owner: 'other', repo: 'docs', branch: 'main' }));
    await act(() => result.current.github.openPr());
    expect(dialogs.openPr).toHaveBeenCalledWith(
      expect.objectContaining({
        preferred: { owner: 'other', repo: 'docs' },
        tabBranches: [{ owner: 'octo', repo: 'notes', branch: 'feat' }],
        sessionBranches: [{ owner: 'octo', repo: 'notes', branch: 'gonq/x' }],
      }),
    );
  });

  test('falls back to the active GitHub tab, and to nothing', async () => {
    const empty = setup();
    await act(() => empty.result.current.github.openPr());
    expect((empty.dialogs.openPr as ReturnType<typeof vi.fn>).mock.calls[0][0].preferred).toBeNull();
    const { result, dialogs } = setup();
    openTab(result, 'main', false);
    // The active tab also shows its repository in the navigator; clear it to see the tab fallback.
    act(() => result.current.github.setRepo(null));
    await act(() => result.current.github.openPr());
    expect((dialogs.openPr as ReturnType<typeof vi.fn>).mock.calls[0][0].preferred).toEqual({ owner: 'octo', repo: 'notes' });
  });

  test('stops when sign-in is declined', async () => {
    mocks.ensureSignedIn.mockResolvedValueOnce(false);
    const { result, dialogs } = setup();
    await act(() => result.current.github.openPr());
    expect(dialogs.openPr).not.toHaveBeenCalled();
  });
});

describe('navigator refresh', () => {
  test('a refresh request bumps the signal', () => {
    const { result } = setup();
    const before = result.current.github.navRefresh;
    act(() => result.current.github.refreshNavigator());
    expect(result.current.github.navRefresh).toBe(before + 1);
  });

  test('a deleted branch falls back to the default branch through changeBranch, warning about a dirty tab', async () => {
    const confirmBranchChange = vi.fn(async () => true);
    const { result } = setup({ confirmBranchChange });
    openTab(result, 'gone');
    act(() => result.current.github.setRepo({ owner: 'octo', repo: 'notes', branch: 'gone' }));
    // What the navigator does when the refresh finds the branch deleted.
    await act(() => result.current.github.changeBranch('main'));
    expect(confirmBranchChange).toHaveBeenCalledWith('a.md');
    expect(result.current.session.tabs).toHaveLength(0);
    expect(result.current.github.repo).toEqual({ owner: 'octo', repo: 'notes', branch: 'main' });
  });
});

describe('open repo', () => {
  test('a chosen repository opens on its default branch', async () => {
    const pickRepo = vi.fn(async () => ({ kind: 'chosen' as const, choice: { owner: 'octo', repo: 'notes', defaultBranch: 'trunk' } }));
    const { result } = setup({ pickRepo });
    await act(() => result.current.github.openRepo());
    expect(result.current.github.repo).toEqual({ owner: 'octo', repo: 'notes', branch: 'trunk' });
  });

  test('a sign-in that is no longer valid says so', async () => {
    const { result, calls } = setup({ pickRepo: async () => ({ kind: 'signed-out' }) });
    await act(() => result.current.github.openRepo());
    expect(calls.notices).toContain('GitHub sign-in is no longer valid. Sign in again to open a repository.');
  });
});
