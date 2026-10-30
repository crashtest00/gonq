/**
 * useGithubController: the GitHub flows shared by every shell (desktop today, mobile next). Owns the repository
 * and branch the navigator shows, the branches made this session, the open-pull-request read-only state, the
 * sign-in handler (ensureSignedIn), Open Repo, Open PR, Create branch, Commit (with its conflict handling),
 * change branch with the unsaved-changes warning, and the navigator refresh signal. It renders no dialogs: the
 * shell injects each choice as an async callback (`GithubDialogs`) and shows banners from `onError` / `onNotice`.
 * The navigator's deleted-branch fallback ends in `changeBranch(defaultBranch)`, so it warns like any change.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { DocumentMeta, useDocument } from '../document/useDocument';
import { PULL_CHECK_FAILED, openPullMessage, useOpenPulls } from '../features/github/openPulls';
import type { CreateOutcome, PendingCommit } from '../features/github/createBranch';
import { addSessionBranch, listSessionBranches, type SessionBranch } from '../features/github/sessionBranches';
import { commitFile, ensureSignedIn, setSignInHandler, type GithubDocument } from '../platform/github';

/** The repository and branch the navigator shows. */
export interface RepoState {
  owner: string;
  repo: string;
  branch: string;
}

export interface RepoChoice {
  owner: string;
  repo: string;
  defaultBranch: string;
}

export type RepoPick = { kind: 'chosen'; choice: RepoChoice } | { kind: 'closed' } | { kind: 'signed-out' };
export type CommitChoice = 'commit' | 'new-branch' | 'cancel';
export type CreateBranchDone = Extract<CreateOutcome, { status: 'done' }>;

/** The dialogs the flows ask through; each shell draws its own. */
export interface GithubDialogs {
  /** The sign-in screen; resolves true when signed in on the way out. */
  signIn: () => Promise<boolean>;
  /** The repository picker (after sign-in). */
  pickRepo: () => Promise<RepoPick>;
  /** Changing branch would close a document with unsaved changes; true to go ahead. */
  confirmBranchChange: (name: string) => Promise<boolean>;
  /** Commit confirmation for a file on a branch. */
  chooseCommit: (target: { owner: string; repo: string; branch: string; path: string }) => Promise<CommitChoice>;
  /** The file changed on GitHub under a commit. Either answer leaves the tab unsaved. */
  showConflict: (conflict: { name: string; deleted: boolean }) => Promise<unknown>;
  /** Create branch; `onCreated` runs as soon as the branch exists. Null when dismissed. */
  createBranch: (args: {
    owner: string;
    repo: string;
    source: string;
    commit: PendingCommit | null;
    onCreated: (branch: string) => void;
  }) => Promise<CreateBranchDone | null>;
  /** The Open PR flow; `onOpened` reports a pull request as soon as GitHub has created it. */
  openPr: (args: {
    preferred: { owner: string; repo: string } | null;
    tabBranches: SessionBranch[];
    sessionBranches: SessionBranch[];
    onOpened: (opened: { owner: string; repo: string; branch: string; pull: { number: number; url: string } }) => void;
  }) => Promise<unknown>;
}

export interface GithubControllerOptions {
  session: ReturnType<typeof useDocument>;
  dialogs: GithubDialogs;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
  /** A repository was chosen in Open Repo: the shell shows its navigator. */
  onRepoChosen?: () => void;
}

export const SIGNED_OUT_NOTICE = 'GitHub sign-in is no longer valid. Sign in again to open a repository.';

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useGithubController(options: GithubControllerOptions) {
  const { session } = options;
  // Callbacks are read at call time, so a shell may pass fresh closures every render.
  const opts = useRef(options);
  opts.current = options;
  const failed = useCallback((e: unknown) => opts.current.onError(messageOf(e)), []);
  const { meta } = session;
  const [repo, setRepo] = useState<RepoState | null>(null);
  // Branches made with Create branch in this session (sessionBranches.ts, kept as state to re-render the dropdown).
  const [createdBranches, setCreatedBranches] = useState<SessionBranch[]>([]);
  const [navRefresh, setNavRefresh] = useState(0);
  // A GitHub tab whose branch has an open pull request is read-only (features/github/openPulls.ts).
  const opens = useOpenPulls(meta?.github ?? null, session.activeId);
  const opensRef = useRef(opens);
  opensRef.current = opens;
  const readOnlyPull = opens.pullFor(meta?.github ?? null);

  // Activating a GitHub tab shows its repository and branch in the navigator, even after Open Folder or Open Repo.
  const ghOwner = meta?.github?.owner;
  const ghRepo = meta?.github?.repo;
  const ghBranch = meta?.github?.branch;
  useEffect(() => {
    if (ghOwner === undefined || ghRepo === undefined || ghBranch === undefined) return;
    setRepo((r) => (r !== null && r.owner === ghOwner && r.repo === ghRepo && r.branch === ghBranch ? r : { owner: ghOwner, repo: ghRepo, branch: ghBranch }));
  }, [session.activeId, ghOwner, ghRepo, ghBranch]);

  // One sign-in dialog at a time: a second request joins the first.
  const signInOpen = useRef<Promise<boolean> | null>(null);
  useEffect(
    () =>
      setSignInHandler(() => {
        if (signInOpen.current !== null) return signInOpen.current;
        const asked = opts.current.dialogs.signIn();
        signInOpen.current = asked;
        void asked.finally(() => {
          signInOpen.current = null;
        });
        return asked;
      }),
    [],
  );

  /**
   * Opens the Create branch dialog for the open repository. `tab` is the active GitHub tab, if any: its branch is
   * the source, and when it is dirty the dialog also commits its file to the new branch, after which the tab
   * (and the navigator) move to it. Otherwise only the branch is made and nothing else moves. Returns true when
   * the tab's changes were committed to the new branch.
   */
  const makeBranch = useCallback(
    async (tab: { id: number; gh: GithubDocument; meta: DocumentMeta; text: string; dirty: boolean } | null): Promise<boolean> => {
      const base = tab?.gh ?? repo;
      if (base === null) return false;
      const source = tab !== null ? tab.gh.branch : repo!.branch;
      const commit = tab !== null && tab.dirty ? { path: tab.gh.path, text: tab.text, sha: tab.gh.sha } : null;
      const result = await opts.current.dialogs.createBranch({
        owner: base.owner,
        repo: base.repo,
        source,
        commit,
        onCreated: (branch: string) => {
          const b = { owner: base.owner, repo: base.repo, branch };
          addSessionBranch(b);
          setCreatedBranches((prev) => (prev.some((p) => p.owner === b.owner && p.repo === b.repo && p.branch === b.branch) ? prev : [...prev, b]));
        },
      });
      if (result === null || result.commit === null || tab === null) return false;
      opts.current.onError(null);
      opts.current.onNotice(null);
      session.saved(tab.id, { ...tab.meta, github: { ...tab.gh, branch: result.branch, sha: result.commit.sha, commitSha: result.commit.commitSha } }, tab.text);
      setRepo({ owner: tab.gh.owner, repo: tab.gh.repo, branch: result.branch });
      return true;
    },
    [repo, session.saved],
  );

  const openCreateBranch = useCallback(() => {
    const id = session.activeId;
    const tab = id === null ? null : session.peek(id);
    const gh = tab?.meta.github;
    void makeBranch(id !== null && tab !== null && gh !== undefined ? { id, gh, meta: tab.meta, text: tab.text, dirty: tab.dirty } : null);
  }, [session.activeId, session.peek, makeBranch]);

  /**
   * Commits a GitHub tab's saved text to the branch it was opened from; true when committed. Nothing is
   * called when there is nothing to commit; a conflict shows the conflict choice and writes nothing.
   * The commit dialog's 'Commit to new branch…' choice hands over to makeBranch (branch-and-commit).
   * A pull request open for the branch (found by a fresh check) refuses before the dialog is shown, and so does a
   * check that cannot complete.
   */
  const commitGithub = useCallback(
    async (id: number, gh: GithubDocument, text: string, dirty: boolean, meta: DocumentMeta): Promise<boolean> => {
      const noChanges = () => {
        opts.current.onNotice('No changes to commit');
        return true;
      };
      const known = opensRef.current.pullFor(gh);
      if (!dirty && known === null) return noChanges();
      let pull = known;
      try {
        pull = await opensRef.current.checkNow(gh);
      } catch {
        // Fail closed: with no answer, nothing is written.
        if (known === null) {
          opts.current.onError(PULL_CHECK_FAILED);
          return false;
        }
      }
      if (pull !== null) {
        opts.current.onError(openPullMessage(pull));
        return false;
      }
      if (!dirty) return noChanges();
      const choice = await opts.current.dialogs.chooseCommit({ owner: gh.owner, repo: gh.repo, branch: gh.branch, path: gh.path });
      if (choice === 'new-branch') return makeBranch({ id, gh, meta, text, dirty });
      if (choice !== 'commit') return false;
      try {
        const result = await commitFile({ owner: gh.owner, repo: gh.repo, branch: gh.branch, path: gh.path, text, sha: gh.sha });
        if (result.status === 'conflict') {
          // The file changed on GitHub: the same dialog as a remote save. Overwrite has nothing to force, so
          // either answer leaves the tab unsaved and writes nothing.
          await opts.current.dialogs.showConflict({ name: meta.name, deleted: false });
          return false;
        }
        opts.current.onError(null);
        opts.current.onNotice(null);
        addSessionBranch({ owner: gh.owner, repo: gh.repo, branch: gh.branch });
        session.saved(id, { ...meta, github: { ...gh, sha: result.sha, commitSha: result.commitSha } }, text);
        return true;
      } catch (e) {
        failed(e);
        return false;
      }
    },
    [session.saved, makeBranch, failed],
  );

  /**
   * The navigator's branch dropdown (and its deleted-branch fallback). A GitHub document open on another branch
   * is closed first (after a warning when it has unsaved changes) and no tab is selected; Cancel leaves the
   * repo, branch and tabs as they were.
   */
  const changeBranch = useCallback(
    async (branch: string) => {
      const id = session.activeId;
      const tab = id === null ? null : session.peek(id);
      if (id !== null && tab?.meta.github && tab.meta.github.branch !== branch) {
        if (tab.dirty && !(await opts.current.dialogs.confirmBranchChange(tab.meta.name))) return;
        session.closeSelectingNone(id);
      }
      setRepo((r) => (r === null ? r : { ...r, branch }));
    },
    [session.activeId, session.peek, session.closeSelectingNone],
  );

  // File > Open Repo…: sign in first if needed, then the picker.
  const openRepo = useCallback(async () => {
    try {
      if (!(await ensureSignedIn())) return;
      const result = await opts.current.dialogs.pickRepo();
      if (result.kind === 'chosen') {
        // The navigator opens on the default branch; a document or folder chosen later replaces the repository.
        setRepo({ owner: result.choice.owner, repo: result.choice.repo, branch: result.choice.defaultBranch });
        opts.current.onError(null);
        opts.current.onRepoChosen?.();
      } else if (result.kind === 'signed-out') opts.current.onNotice(SIGNED_OUT_NOTICE);
    } catch (e) {
      failed(e);
    }
  }, [failed]);

  // File > Open PR…: sign in first if needed, then the dialog on the navigator's repository (or the active GitHub tab's).
  const openPr = useCallback(async () => {
    try {
      if (!(await ensureSignedIn())) return;
      const tabBranches = session.tabs.filter((t) => t.github !== undefined).map((t) => ({ owner: t.github!.owner, repo: t.github!.repo, branch: t.github!.branch }));
      const active = meta?.github;
      await opts.current.dialogs.openPr({
        preferred: repo !== null ? { owner: repo.owner, repo: repo.repo } : active !== undefined ? { owner: active.owner, repo: active.repo } : null,
        tabBranches,
        sessionBranches: listSessionBranches(),
        // Every tab on the branch turns read-only at once (the same mechanism as the open-PR guard).
        onOpened: ({ owner, repo: name, branch, pull }) => opensRef.current.markOpen({ owner, repo: name, branch }, { number: pull.number, url: pull.url, draft: false }),
      });
    } catch (e) {
      failed(e);
    }
  }, [session.tabs, meta, repo, failed]);

  const refreshNavigator = useCallback(() => setNavRefresh((n) => n + 1), []);

  return {
    /** The repository and branch the navigator shows; null when a folder (or nothing) is shown. */
    repo,
    setRepo,
    createdBranches,
    /** Bumps on every refresh request; the navigator re-lists when it changes. */
    navRefresh,
    refreshNavigator,
    /** The open pull request that makes the active tab read-only, or null. */
    readOnlyPull,
    canOpenPr: repo !== null || session.tabs.some((t) => t.github !== undefined),
    commitGithub,
    changeBranch,
    openCreateBranch,
    openRepo,
    openPr,
  };
}
