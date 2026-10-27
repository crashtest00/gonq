/**
 * The app shell: owns the open tabs (useDocument), the one MarkdownEditor, the menu bar and toolbars, the
 * folder/outline/comments sidebars and <DialogHost/> (every dialog is opened with openDialog, see dialogs/), builds the CommandContext the command registry's menus and shortcuts run against, and wires its actions to platform/ calls (open, save,
 * connect, GitHub sign-in, repo picker and its open repo/branch, GitHub files in tabs and the navigator following them, launch paths). Errors land in its banner.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from './lib/useTheme';
import { MenuBar } from './components/MenuBar';
import { registry, type CommandContext } from './commands';
import { DialogHost, openDialog, type DialogRef } from './dialogs/DialogHost';
import {
  aboutDialog,
  agentSkillDialog,
  commitDialog,
  createBranchDialog,
  openPrDialog,
  conflictDialog,
  connectDialog,
  settingsDialog,
  repoPickerDialog,
  unsavedChangesDialog,
  branchChangeDialog,
} from './dialogs/dialogs';
import { DEFAULT_AUTHOR, getAuthorName, setAuthorName } from './platform/settings';
import { TabStrip } from './components/TabStrip';
import { EditToolbar } from './components/EditToolbar';
import { EditorContextMenu } from './components/EditorContextMenu';
import { TableToolbar } from './components/TableToolbar';
import type { TableTarget } from './editor/tables';
import { ResizablePane } from './components/ResizablePane';
import { usePaneWidths } from './components/paneWidths';
import { OutlineSidebar } from './components/OutlineSidebar';
import { outlineOf } from './components/outline';
import { CommentsSidebar } from './components/CommentsSidebar';
import { RemoteConflictError, RemoteFileError, isSshPath, remoteAccount, remoteHost, setConnectHandler } from './platform/remote';
import type { RepoState } from './components/RepoNavigator';
import { GitHubError, commitFile, ensureSignedIn, parseGithubPath, setSignInHandler, signOut as githubSignOut, type GithubDocument } from './platform/github';
import type { RepoChoice } from './components/RepoPickerDialog';
import { assertConnectAvailable } from './platform/connect';
import { listThreads, threadKey } from './components/threads';
import { isCommentableAt, selectionRange, type ThreadTarget } from './components/newThread';
import { parseCommentMarkers, appendToThread, deleteThread, editThreadMessage, normalizeAnchor, setThreadStatus } from './comment-threads';
import { RawSwitch } from './components/RawSwitch';
import { MarkdownEditor, type EditorHandle, type EditorSelection } from './editor/MarkdownEditor';
import { useDocument, type DocumentMeta } from './document/useDocument';
import { files as defaultFiles, type FileAccess } from './platform/files';
import { guardClose } from './platform/lifecycle';
import { pickImage } from './platform/images';
import { addSessionBranch, listSessionBranches, type SessionBranch } from './features/github/sessionBranches';
import { PULL_CHECK_FAILED, openPullMessage, useOpenPulls } from './features/github/openPulls';
import { ReadOnlyBanner } from './components/ReadOnlyBanner';
import { listenOpenPaths, takePendingOpenPaths } from './platform/openPaths';
import { FolderSidebar } from './components/FolderSidebar';
import { pathExists, pickFolder } from './platform/folders';
import { addRecent, allowRecentDocument, listRecents, removeRecent, type RecentDocument } from './platform/recents';

function parentDir(path: string): string | null {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (i < 0) return null;
  return i === 0 ? path.slice(0, 1) : path.slice(0, i);
}

export default function App({ files = defaultFiles }: { files?: FileAccess }) {
  const session = useDocument();
  const { meta, text } = session;
  // A GitHub tab whose branch has an open pull request is read-only (features/github/openPulls.ts).
  const opens = useOpenPulls(meta?.github ?? null, session.activeId);
  const opensRef = useRef(opens);
  opensRef.current = opens;
  const readOnlyPull = opens.pullFor(meta?.github ?? null);
  const rawAll = session.raw;
  const [error, setError] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const paneLayout = usePaneWidths();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  // Once the user picks a folder with Open Folder…, opening documents no longer moves the Project folder.
  const folderChosen = useRef(false);
  const [recents, setRecents] = useState<RecentDocument[]>([]);
  // The GitHub repository and branch the navigator shows; null when a folder (or nothing) is shown.
  const [repo, setRepo] = useState<RepoState | null>(null);
  // Branches made with Create branch in this session (the session list in sessionBranches.ts, kept as state to re-render the dropdown).
  const [createdBranches, setCreatedBranches] = useState<SessionBranch[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ target: ThreadTarget; text: string; anchor?: string } | null>(null);
  const [tableTarget, setTableTarget] = useState<TableTarget | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const editor = useRef<EditorHandle>(null);
  // A remote save slower than a second says where it is going; an in-place save says it was not atomic.
  const [savingTo, setSavingTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeId = session.activeId;
  const [authorName, setAuthor] = useState(DEFAULT_AUTHOR);
  const [theme, setThemeChoice] = useTheme(useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []));
  // Dialogs are opened through openDialog and shown by <DialogHost/>; see dialogs/dialogs.tsx.
  // The GitHub sign-in runs inside the Settings dialog: ensureSignedIn (platform/github.ts) opens Settings already signing in.
  const githubOpen = useRef<Promise<boolean> | null>(null);
  const threads = useMemo(() => (meta === null ? [] : listThreads(text)), [meta, text]);
  const outline = useMemo(() => (outlineOpen && meta !== null ? outlineOf(text) : []), [outlineOpen, meta, text]);

  useEffect(() => {
    let live = true;
    getAuthorName().then((n) => live && setAuthor(n));
    listRecents().then((list) => live && setRecents(list), () => {});
    return () => {
      live = false;
    };
  }, []);
  // Without an explicit folder, the Project folder follows the open document's parent directory.
  const docPath = meta?.path ?? null;
  useEffect(() => {
    if (docPath === null || folderChosen.current) return;
    // A remote document's parent is not on the allow-list; the remote root comes from the Connect flow.
    if (isSshPath(docPath) || parseGithubPath(docPath) !== null) return;
    const parent = parentDir(docPath);
    if (parent !== null) setFolder(parent);
  }, [docPath]);
  // Activating a GitHub tab shows its repository and branch in the navigator, even after Open Folder or Open Repo.
  const gh = meta?.github;
  const ghOwner = gh?.owner;
  const ghRepo = gh?.repo;
  const ghBranch = gh?.branch;
  useEffect(() => {
    if (ghOwner === undefined || ghRepo === undefined || ghBranch === undefined) return;
    setRepo((r) => (r !== null && r.owner === ghOwner && r.repo === ghRepo && r.branch === ghBranch ? r : { owner: ghOwner, repo: ghRepo, branch: ghBranch }));
  }, [activeId, ghOwner, ghRepo, ghBranch]);
  const remember = useCallback((path: string | null) => {
    if (path !== null) addRecent(path).then(setRecents, () => {});
  }, []);

  const launchError = useRef<string | null>(null);
  // Switching tabs: the comments sidebar goes back to All threads.
  useEffect(() => {
    setSelectedKey(null);
    setDraft(null);
    setSelection(null);
    setCaret(null);
    // Errors from paths opened at launch outlive the tab switch they caused.
    setError(launchError.current);
    launchError.current = null;
  }, [activeId]);

  const textRef = useRef(text);
  textRef.current = text;
  const liveSelection = useMemo(() => {
    const range = selection === null ? null : selectionRange(text, selection.from, selection.to);
    return selection !== null && range !== null ? { ...range, x: selection.x, y: selection.y } : null;
  }, [selection, text]);
  const liveCaret = caret !== null && caret <= text.length ? caret : null;
  const canAddAtCursor = liveCaret !== null && isCommentableAt(text, liveCaret);

  const startDraft = useCallback(
    (target: ThreadTarget) => {
      const anchor = typeof target === 'number' ? undefined : normalizeAnchor(text.slice(target.from, target.to));
      setSelectedKey(null);
      setCommentsOpen(true);
      setDraft({ target, text, ...(anchor === undefined ? {} : { anchor }) });
    },
    [text],
  );
  const addComment = useCallback(() => {
    if (liveSelection !== null) startDraft(liveSelection);
    else if (canAddAtCursor && liveCaret !== null) startDraft(liveCaret);
  }, [liveSelection, canAddAtCursor, liveCaret, startDraft]);

  const submitDraft = useCallback(
    (body: string) => {
      if (draft === null || body.trim() === '') return;
      if (draft.text !== text) {
        setDraft(null);
        return setError('The document changed while you were writing; start the comment again.');
      }
      try {
        if (editor.current === null) throw new Error('No document is open.');
        const before = new Set(listThreads(text).map((t) => t.thread.id));
        const next = editor.current.createThread(draft.target, authorName, body.trim());
        const created = listThreads(next).find((t) => !before.has(t.thread.id));
        setError(null);
        setDraft(null);
        setSelection(null);
        editor.current?.collapse();
        if (created) {
          setSelectedKey(created.key);
          revealThread(next, created.thread.id, created.ordinal);
        }
      } catch (e) {
        failed(e);
      }
    },
    [draft, text, authorName, editor],
  );

  const reply = useCallback(
    (key: string, body: string) => {
      const item = threads.find((t) => t.key === key);
      if (item === undefined || body.trim() === '') return;
      try {
        editor.current?.setText(appendToThread(text, { id: item.thread.id, ordinal: item.ordinal }, authorName, body.trim()));
        setError(null);
      } catch (e) {
        failed(e);
      }
    },
    [threads, text, authorName, editor],
  );

  const setStatus = useCallback(
    (key: string, status: 'open' | 'resolved') => {
      const item = threads.find((t) => t.key === key);
      if (item === undefined) return;
      try {
        editor.current?.setText(setThreadStatus(text, { id: item.thread.id, ordinal: item.ordinal }, status));
        setError(null);
      } catch (e) {
        failed(e);
      }
    },
    [threads, text, editor],
  );

  const edit = useCallback(
    (key: string, body: string) => {
      const item = threads.find((t) => t.key === key);
      if (item === undefined || body.trim() === '') return;
      try {
        editor.current?.setText(editThreadMessage(text, { id: item.thread.id, ordinal: item.ordinal }, body.trim()));
        setError(null);
      } catch (e) {
        failed(e);
      }
    },
    [threads, text, editor],
  );

  const remove = useCallback(
    (key: string) => {
      const item = threads.find((t) => t.key === key);
      if (item === undefined) return;
      try {
        editor.current?.setText(deleteThread(text, { id: item.thread.id, ordinal: item.ordinal }));
        setError(null);
        setSelectedKey(null);
      } catch (e) {
        failed(e);
      }
    },
    [threads, text, editor],
  );

  /** Brings the marker of a thread into view; a thread with no marker has nothing to scroll to. */
  const revealThread = useCallback((doc: string, id: string, ordinal: number) => {
    const marker = parseCommentMarkers(doc).get(id)?.[ordinal];
    if (marker) editor.current?.reveal(marker.from);
  }, []);

  const toggleComments = useCallback(() => {
    // Each reopen starts at the All threads list.
    setSelectedKey(null);
    setDraft(null);
    setCommentsOpen((open) => !open);
  }, []);

  const openThread = useCallback(
    (key: string) => {
      setSelectedKey(key);
      setCommentsOpen(true);
      const item = listThreads(textRef.current).find((t) => t.key === key);
      if (item) revealThread(textRef.current, item.thread.id, item.ordinal);
    },
    [revealThread],
  );

  const jumpToHeading = useCallback((from: number) => editor.current?.reveal(from, true), []);

  const failed = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

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
      const result = await openDialog(createBranchDialog, {
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
      setError(null);
      setNotice(null);
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
   * called when there is nothing to commit; a conflict opens the ConflictDialog and writes nothing.
   * The dialog's 'Commit to new branch…' choice hands over to makeBranch (branch-and-commit).
   * A pull request open for the branch (found by a fresh check) refuses before the dialog is shown, and so does a
   * check that cannot complete.
   */
  const commitGithub = useCallback(
    async (id: number, gh: GithubDocument, text: string, dirty: boolean, meta: DocumentMeta): Promise<boolean> => {
      const noChanges = () => {
        setNotice('No changes to commit');
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
          setError(PULL_CHECK_FAILED);
          return false;
        }
      }
      if (pull !== null) {
        setError(openPullMessage(pull));
        return false;
      }
      if (!dirty) return noChanges();
      const choice = await openDialog(commitDialog, { owner: gh.owner, repo: gh.repo, branch: gh.branch, path: gh.path });
      if (choice === 'new-branch') return makeBranch({ id, gh, meta, text, dirty });
      if (choice !== 'commit') return false;
      try {
        const result = await commitFile({ owner: gh.owner, repo: gh.repo, branch: gh.branch, path: gh.path, text, sha: gh.sha });
        if (result.status === 'conflict') {
          // The file changed on GitHub: the same dialog as a remote save. Overwrite has nothing to force, so
          // either answer leaves the tab unsaved and writes nothing.
          await openDialog(conflictDialog, { name: meta.name, deleted: false });
          return false;
        }
        setError(null);
        setNotice(null);
        addSessionBranch({ owner: gh.owner, repo: gh.repo, branch: gh.branch });
        session.saved(id, { ...meta, github: { ...gh, sha: result.sha, commitSha: result.commitSha } }, text);
        return true;
      } catch (e) {
        failed(e);
        return false;
      }
    },
    [session.saved, makeBranch],
  );

  /** Writes tab `id`; true when it is on disk, false when cancelled or failed. */
  const doWrite = useCallback(
    async (id: number, as: boolean): Promise<boolean> => {
      const tab = session.peek(id);
      if (tab === null) return true;
      // What is written is what is marked saved, even if typing continues meanwhile.
      const snapshot = tab.text;
      // Save on a GitHub tab commits (after a confirmation); Save As is not offered for GitHub files yet.
      if (!as && tab.meta.github !== undefined) return commitGithub(id, tab.meta.github, snapshot, tab.dirty, tab.meta);
      // Save As may not land on a file another tab holds.
      const taken = (path: string) => session.peekTabs().some((t) => t.id !== id && t.path === path);
      const remotePath = !as && tab.meta.path !== null && isSshPath(tab.meta.path) ? tab.meta.path : null;
      const slow = remotePath === null ? null : setTimeout(() => setSavingTo(remoteHost(remotePath)), 1000);
      try {
        const doc = { name: tab.meta.name, path: tab.meta.path, text: snapshot, remote: tab.meta.remote };
        let saved;
        if (as) saved = await files.saveDocumentAs({ name: tab.meta.name, text: snapshot }, taken);
        else if (tab.meta.path === null) saved = await files.saveDocument({ ...doc, path: null }, taken);
        else {
          try {
            saved = await files.saveDocument(doc);
          } catch (e) {
            if (!(e instanceof RemoteConflictError)) throw e;
            if (slow !== null) clearTimeout(slow);
            setSavingTo(null);
            const choice = await openDialog(conflictDialog, { name: e.name_, deleted: e.deleted });
            // Cancel leaves the tab unsaved, text intact.
            if (choice === 'cancel') return false;
            saved = await files.saveDocument(doc, undefined, { force: true });
          }
        }
        if (saved === null) return false;
        if (saved.path !== null && saved.path !== tab.meta.path && taken(saved.path)) {
          setError(`${saved.path} is already open in another tab, so it was not saved there. Choose another name.`);
          return false;
        }
        setError(null);
        if (saved.inPlaceHost !== undefined) {
          setNotice(`Saved in place on ${remoteHost(saved.inPlaceHost)} (not atomic): the server can't swap files safely, so a dropped connection could leave the file half written.`);
        }
        session.saved(id, { name: saved.name, path: saved.path, remote: saved.remote }, snapshot);
        if (saved.path !== tab.meta.path) remember(saved.path);
        return true;
      } catch (e) {
        failed(e);
        return false;
      } finally {
        if (slow !== null) clearTimeout(slow);
        setSavingTo(null);
      }
    },
    [files, session.peek, session.peekTabs, session.saved, remember, commitGithub],
  );
  // One save per tab at a time: a request made while one is pending joins it (no parallel write, no second dialog).
  const pendingSaves = useRef(new Map<number, Promise<boolean>>());
  const write = useCallback(
    (id: number, as: boolean): Promise<boolean> => {
      const pending = pendingSaves.current.get(id);
      if (pending !== undefined && !as) return pending;
      const run = (pending ?? Promise.resolve(true)).then(() => doWrite(id, as));
      const tracked = run.finally(() => {
        if (pendingSaves.current.get(id) === tracked) pendingSaves.current.delete(id);
      });
      pendingSaves.current.set(id, tracked);
      return tracked;
    },
    [doWrite],
  );
  const save = useCallback(() => (activeId === null ? Promise.resolve(true) : write(activeId, false)), [write, activeId]);
  const saveAs = useCallback(() => (activeId === null ? Promise.resolve(true) : write(activeId, true)), [write, activeId]);

  /** Resolves true when it is fine to close tab `id`: clean, saved or discarded. Shows the tab while it asks. */
  const confirmTab = useCallback(
    async (id: number): Promise<boolean> => {
      const tab = session.peek(id);
      if (tab === null || !tab.dirty) return true;
      session.activate(id);
      const choice = await openDialog(unsavedChangesDialog, { name: tab.meta.name });
      if (choice === 'save') return write(id, false);
      return choice === 'discard';
    },
    [session.peek, session.activate, write],
  );

  const closeTab = useCallback(
    async (id: number) => {
      if (await confirmTab(id)) session.close(id);
    },
    [confirmTab, session.close],
  );

  /**
   * The navigator's branch dropdown. A GitHub document open on another branch is closed first (after a
   * warning when it has unsaved changes) and no tab is selected; Cancel leaves the repo, branch and tabs as they were.
   */
  const changeBranch = useCallback(
    async (branch: string) => {
      const id = session.activeId;
      const tab = id === null ? null : session.peek(id);
      if (id !== null && tab?.meta.github && tab.meta.github.branch !== branch) {
        if (tab.dirty && !(await openDialog(branchChangeDialog, { name: tab.meta.name }))) return;
        session.closeSelectingNone(id);
      }
      setRepo((r) => (r === null ? r : { ...r, branch }));
    },
    [session.activeId, session.peek, session.closeSelectingNone],
  );

  const newFile = useCallback(() => {
    setError(null);
    session.openUntitled();
  }, [session.openUntitled]);

  const openFile = useCallback(async () => {
    try {
      const opened = await files.pickDocument();
      if (opened === null) return;
      setError(null);
      session.open(opened);
      remember(opened.path);
    } catch (e) {
      // A file that cannot be opened leaves whatever is already open untouched.
      failed(e);
    }
  }, [files, session.open, remember]);

  /** Opens a file chosen in the folder navigator or the recent list. */
  const openKnownPath = useCallback(
    async (path: string, fromRecents: boolean) => {
      if (files.openPath === undefined) return;
      const github = parseGithubPath(path);
      // Reopening a GitHub recent shows its repository and branch in the navigator.
      if (github !== null && fromRecents) {
        setRepo((r) => (r !== null && r.owner === github.owner && r.repo === github.repo && r.branch === github.branch ? r : { owner: github.owner, repo: github.repo, branch: github.branch }));
        folderChosen.current = true;
        setFolderOpen(true);
      }
      // A file that is already open is shown as it is, unsaved changes and all.
      const existing = session.findByPath(path);
      if (existing !== null) return session.activate(existing);
      try {
        if (fromRecents && github === null) {
          await allowRecentDocument(path);
          // A remote file stays in the list when its host is unreachable; opening it reports why.
          if (!isSshPath(path) && !(await pathExists(path))) {
            await removeRecent(path).then(setRecents, () => {});
            return setError(`${path} no longer exists, so it was removed from recent documents.`);
          }
        }
        let opened;
        try {
          opened = await files.openPath(path);
        } catch (e) {
          // Not signed in: run the sign-in, then read the file once more.
          if (!(e instanceof GitHubError && e.kind === 'not_signed_in' && (await ensureSignedIn()))) throw e;
          opened = await files.openPath(path);
        }
        setError(null);
        session.open(opened);
        remember(opened.path);
      } catch (e) {
        // Only a file the server says is gone leaves the recent list.
        if (fromRecents && e instanceof RemoteFileError && e.kind === 'not_found') await removeRecent(path).then(setRecents, () => {});
        failed(e);
      }
    },
    [files, session.findByPath, session.activate, session.open, remember],
  );

  /** Opens one path the OS delivered; resolves the reason it was not opened, else null. */
  const openLaunchPath = useCallback(
    async (path: string): Promise<string | null> => {
      if (!/\.(md|markdown)$/i.test(path)) return `${path} is not a Markdown file (.md or .markdown), so it was not opened.`;
      const existing = session.findByPath(path);
      if (existing !== null) {
        session.activate(existing);
        return null;
      }
      try {
        if (files.openPath === undefined) throw new Error(`${path} cannot be opened here.`);
        const opened = await files.openPath(path);
        session.open(opened);
        remember(opened.path);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    [files, session.findByPath, session.activate, session.open, remember],
  );

  // Launch paths run one batch at a time, in order; one that fails does not stop the others.
  const launchChain = useRef<Promise<void>>(Promise.resolve());
  const openLaunchPaths = useCallback(
    (paths: string[]) => {
      launchChain.current = launchChain.current.then(async () => {
        const errors: string[] = [];
        for (const path of paths) {
          const reason = await openLaunchPath(path);
          if (reason !== null) errors.push(reason);
        }
        if (errors.length === 0) return;
        const message = errors.join(' ');
        // A tab switch from this batch clears the banner; hand the message to that effect instead.
        launchError.current = message;
        setError(message);
        setTimeout(() => (launchError.current = null), 0);
      });
    },
    [openLaunchPath],
  );
  const openLaunchPathsRef = useRef(openLaunchPaths);
  openLaunchPathsRef.current = openLaunchPaths;
  useEffect(() => {
    // Subscribe first so a launch between the two steps is queued, not lost.
    const early: string[][] = [];
    let ready = false;
    const deliver = (paths: string[]) => (ready ? openLaunchPathsRef.current(paths) : early.push(paths));
    const stop = listenOpenPaths(deliver);
    let live = true;
    takePendingOpenPaths().then(
      (pending) => {
        if (!live) return;
        ready = true;
        if (pending.length > 0) openLaunchPathsRef.current(pending);
        for (const paths of early) openLaunchPathsRef.current(paths);
      },
      (e) => {
        ready = true;
        for (const paths of early) openLaunchPathsRef.current(paths);
        if (live) setError(e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
      stop();
    };
  }, []);

  const openFromFolder = useCallback(
    (path: string) => {
      void openKnownPath(path, false);
    },
    [openKnownPath],
  );

  const openFolder = useCallback(async () => {
    try {
      const picked = await pickFolder();
      if (picked === null) return;
      folderChosen.current = true;
      setFolder(picked);
      setRepo(null);
      setError(null);
      setOutlineOpen(false);
      setFolderOpen(true);
    } catch (e) {
      failed(e);
    }
  }, []);

  /** Whether an open tab or the navigator root still uses the session for this host (user@host, or a bare host). */
  const hostInUse = useCallback(
    (name: string) => {
      const want = name.toLowerCase().replace(/^ssh:\/\//, '');
      const same = (path: string) => {
        if (!isSshPath(path)) return false;
        const account = remoteAccount(path).toLowerCase();
        return account === want || account.endsWith(`@${want}`);
      };
      return session.peekTabs().some((t) => t.path !== null && same(t.path)) || (folder !== null && same(folder));
    },
    [session.peekTabs, folder],
  );
  // Each Connect request is its own dialog; DialogHost shows them one at a time, in the order they were asked.
  const hostInUseRef = useRef(hostInUse);
  hostInUseRef.current = hostInUse;
  const openedRemoteFolderRef = useRef<(uri: string) => void>(() => {});
  const connectsOpen = useRef(0);
  const requestConnect = useCallback((host: string | undefined, reconnect: boolean): Promise<boolean> => {
    connectsOpen.current++;
    return openDialog(connectDialog, {
      host,
      reconnect,
      inUse: (name: string) => hostInUseRef.current(name),
      onOpened: (uri: string) => openedRemoteFolderRef.current(uri),
    }).finally(() => connectsOpen.current--);
  }, []);
  /** File > Connect to Server; does nothing while a Connect dialog is already open. */
  const openConnect = useCallback((host?: string): Promise<boolean> => {
    try {
      assertConnectAvailable();
    } catch (e) {
      failed(e);
      return Promise.resolve(false);
    }
    if (connectsOpen.current > 0) return Promise.resolve(false);
    return requestConnect(host, false);
  }, [requestConnect]);
  const doGithubSignOut = useCallback(async () => {
    try {
      await githubSignOut();
      setError(null);
      setNotice('Signed out of GitHub.');
    } catch (e) {
      failed(e);
    }
  }, []);
  // Settings, Agent skill and About are single dialogs: asking again while one is open does nothing.
  const singles = useRef(new Set<string>());
  const authorNameRef = useRef(authorName);
  authorNameRef.current = authorName;
  const saveAuthor = useCallback(async (n: string) => setAuthor(await setAuthorName(n)), []);
  const requestGithubSignIn = useCallback((): Promise<boolean> => {
    if (githubOpen.current !== null) return githubOpen.current;
    if (singles.current.has(settingsDialog.id)) return Promise.resolve(false);
    singles.current.add(settingsDialog.id);
    const asked = openDialog(settingsDialog, { authorName: authorNameRef.current, onSave: saveAuthor, startSignIn: true, onSignOut: doGithubSignOut });
    githubOpen.current = asked;
    void asked.finally(() => {
      githubOpen.current = null;
      singles.current.delete(settingsDialog.id);
    });
    return asked;
  }, [saveAuthor, doGithubSignOut]);
  useEffect(() => setSignInHandler(requestGithubSignIn), [requestGithubSignIn]);
  // File > Open Repo…: sign in first if needed, then the picker. The navigator (a later story) takes the choice.
  const openRepo = useCallback(async () => {
    try {
      if (!(await ensureSignedIn())) return;
      const result = await openDialog(repoPickerDialog, {});
      if (result.kind === 'chosen') repoChosen(result.choice);
      else if (result.kind === 'signed-out') repoSignedOut();
    } catch (e) {
      failed(e);
    }
  }, []);
  // File > Open PR…: sign in first if needed, then the three-step dialog on the navigator's repository (or the active GitHub tab's).
  const openPr = useCallback(async () => {
    try {
      if (!(await ensureSignedIn())) return;
      const gh = session.tabs.filter((t) => t.github !== undefined).map((t) => ({ owner: t.github!.owner, repo: t.github!.repo, branch: t.github!.branch }));
      const active = meta?.github;
      await openDialog(openPrDialog, {
        preferred: repo !== null ? { owner: repo.owner, repo: repo.repo } : active !== undefined ? { owner: active.owner, repo: active.repo } : null,
        tabBranches: gh,
        sessionBranches: listSessionBranches(),
        // Every tab on the branch turns read-only at once (the same mechanism as the open-PR guard).
        onOpened: ({ owner, repo: name, branch, pull }) => opensRef.current.markOpen({ owner, repo: name, branch }, { number: pull.number, url: pull.url, draft: false }),
      });
    } catch (e) {
      failed(e);
    }
  }, [session.tabs, meta, repo]);
  const repoChosen = (choice: RepoChoice) => {
    // The navigator opens on the default branch; a document or folder chosen later replaces the repository.
    folderChosen.current = true;
    setRepo({ owner: choice.owner, repo: choice.repo, branch: choice.defaultBranch });
    setError(null);
    setOutlineOpen(false);
    setFolderOpen(true);
  };
  const repoSignedOut = () => {
    setNotice('GitHub sign-in is no longer valid. Sign in again to open a repository.');
  };
  // A save or a folder expand that needs a login waits on the Connect dialog, then runs again.
  const connectPending = useRef(new Map<string, Promise<boolean>>());
  useEffect(() => {
    return setConnectHandler((path) => {
      const key = remoteAccount(path).toLowerCase();
      const existing = connectPending.current.get(key);
      if (existing !== undefined) return existing;
      const asked = requestConnect(remoteAccount(path), true);
      connectPending.current.set(key, asked);
      void asked.finally(() => connectPending.current.delete(key));
      return asked;
    });
  }, [requestConnect]);
  const openedRemoteFolder = useCallback((uri: string) => {
    folderChosen.current = true;
    setFolder(uri);
    setRepo(null);
    setError(null);
    setOutlineOpen(false);
    setFolderOpen(true);
  }, []);
  openedRemoteFolderRef.current = openedRemoteFolder;

  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const closeActive = useCallback(() => {
    if (activeIdRef.current !== null) void closeTab(activeIdRef.current);
  }, [closeTab]);
  const openSingle = useCallback(<P, R>(dialog: DialogRef<P, R>, props: P) => {
    if (singles.current.has(dialog.id)) return;
    singles.current.add(dialog.id);
    void openDialog(dialog, props).finally(() => singles.current.delete(dialog.id));
  }, []);
  const openPrefs = useCallback(
    () => openSingle(settingsDialog, { authorName, onSave: saveAuthor, onSignOut: doGithubSignOut }),
    [openSingle, authorName, saveAuthor, doGithubSignOut],
  );
  const undo = useCallback(() => editor.current?.undo(), []);
  const redo = useCallback(() => editor.current?.redo(), []);
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  const insertImage = () => {
    pickImage(docPath).then(
      (picked) => {
        if (picked === null) return;
        editor.current?.insertImage(picked.src, picked.alt);
        setError(null);
      },
      (e: unknown) => setError(e instanceof Error ? e.message : String(e)),
    );
  };
  const insertToc = () => {
    try {
      editor.current?.insertToc();
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  const commandContext: CommandContext = {
    hasDocument: meta !== null,
    canUndo: session.canUndo,
    canRedo: session.canRedo,
    raw: rawAll,
    theme,
    tableTarget,
    editor,
    session,
    files,
    setError,
    openDialog,
    save: () => void save(),
    saveAs: () => void saveAs(),
    isGithubTab: meta?.github !== undefined,
    readOnly: readOnlyPull !== null,
    commit: () => void save(),
    newFile,
    openFile: () => void openFile(),
    closeTab: closeActive,
    openFolder: () => void openFolder(),
    openConnect: () => void openConnect(),
    openRepo: () => void openRepo(),
    canOpenPr: repo !== null || session.tabs.some((t) => t.github !== undefined),
    openPr: () => void openPr(),
    openSettings: openPrefs,
    insertImage,
    insertToc,
    setRaw: session.setRaw,
    setTheme: setThemeChoice,
    openAgentSkill: () => openSingle(agentSkillDialog, { files }),
    openAbout: () => openSingle(aboutDialog, {}),
    hasSelection: selection !== null,
    canAddComment: readOnlyPull === null && (liveSelection !== null || canAddAtCursor),
    addComment,
  };
  // The one keydown handler is generated from the registered shortcuts and reads the latest context.
  const commandContextRef = useRef(commandContext);
  commandContextRef.current = commandContext;
  useEffect(() => registry.installShortcuts(() => commandContextRef.current), []);

  // Closing the window with unsaved changes asks first.
  // Every unsaved tab is asked about in turn; Cancel on any of them keeps the window open.
  const confirmWindowClose = useCallback(async () => {
    for (const id of session.dirtyIds()) if (!(await confirmTab(id))) return false;
    return true;
  }, [session.dirtyIds, confirmTab]);
  const guard = useRef({ anyDirty: session.dirtyIds, confirmWindowClose });
  guard.current = { anyDirty: session.dirtyIds, confirmWindowClose };
  useEffect(() => guardClose(() => guard.current.anyDirty().length > 0, () => guard.current.confirmWindowClose()), []);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background font-sans text-foreground">
      <MenuBar ctx={commandContext} />
      <TabStrip tabs={session.tabs} activeId={activeId} onSelect={(id) => {
        session.activate(id);
        editor.current?.focus();
      }} onClose={(id) => void closeTab(id)} onNew={newFile} onMove={session.move} outlineOpen={outlineOpen} onToggleOutline={() => {
          setOutlineOpen((o) => !o);
          setFolderOpen(false);
        }} folderOpen={folderOpen} onToggleFolder={() => {
          setFolderOpen((o) => !o);
          setOutlineOpen(false);
        }} commentsOpen={commentsOpen} onToggleComments={toggleComments} />
      <div className="flex min-h-0 flex-1">
        {outlineOpen && (
          <ResizablePane pane="outline" edge="right" layout={paneLayout} otherOpen={commentsOpen ? 'comments' : null}>
            <OutlineSidebar items={outline} onJump={jumpToHeading} />
          </ResizablePane>
        )}
        {folderOpen && (
          <ResizablePane pane="navigator" edge="right" layout={paneLayout} otherOpen={commentsOpen ? 'comments' : null}>
          <FolderSidebar
            folder={folder}
            repo={repo}
            createdBranches={createdBranches.filter((b) => b.owner === repo?.owner && b.repo === repo?.repo).map((b) => b.branch)}
            onBranchChange={(branch) => void changeBranch(branch)}
            onCreateBranch={openCreateBranch}
            recents={recents}
            currentPath={meta?.path ?? null}
            onOpenFolder={() => void openFolder()}
            onOpenFile={openFromFolder}
            onLogin={(path) => openConnect(remoteAccount(path))}
            onOpenRecent={(path) => void openKnownPath(path, true)}
            onRemoveRecent={(path) => void removeRecent(path).then(setRecents, () => {})}
          />
          </ResizablePane>
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {readOnlyPull !== null && <ReadOnlyBanner pull={readOnlyPull} />}
          {meta !== null && <EditToolbar canUndo={session.canUndo} canRedo={session.canRedo} onUndo={undo} onRedo={redo} onFormat={(f, url) => editor.current?.format(f, url)} />}
          {meta !== null && tableTarget !== null && (
            <TableToolbar
              target={tableTarget}
              onAction={(op) => editor.current?.tableAction(op)}
              onReturn={() => editor.current?.focusTableCell()}
              onLeave={() => editor.current?.releaseTable()}
            />
          )}
          {(error !== null || savingTo !== null || notice !== null || meta === null) && (
            <div className="mx-auto box-border w-full max-w-[760px] shrink-0 px-10 pt-5">
              {error !== null && (
                <div role="alert" className="mb-5 rounded-control border border-destructive px-3 py-2 text-[13px] text-destructive">
                  {error}
                </div>
              )}
              {savingTo !== null && <div role="status" className="mb-5 text-[13px] text-muted-foreground">Saving to {savingTo}…</div>}
              {notice !== null && (
                <div role="status" className="mb-5 flex items-start justify-between gap-3 rounded-control border border-border px-3 py-2 text-[13px] text-muted-foreground">
                  <span>{notice}</span>
                  <button type="button" aria-label="Dismiss notice" onClick={() => setNotice(null)} className="cursor-pointer border-0 bg-transparent p-0 text-inherit">×</button>
                </div>
              )}
              {meta === null && (
                <p className="text-[13px] text-muted-foreground">Open a document or create a new one.</p>
              )}
            </div>
          )}
          {meta !== null && activeId !== null && (
            <MarkdownEditor
              ref={editor}
              tabId={activeId}
              text={text}
              raw={rawAll}
              readOnly={readOnlyPull !== null}
              tabIds={session.tabIds}
              docPath={meta.path}
              onOpenThread={(id, ordinal) => {
                const key = threadKey(id, ordinal);
                if (!listThreads(textRef.current).some((t) => t.key === key)) return;
                setDraft(null);
                openThread(key);
              }}
              onTable={setTableTarget}
              onContextMenu={(x, y) => setMenu({ x, y })}
              onChange={session.edited}
              onSelection={(sel, head) => {
                setSelection(sel);
                setCaret(head);
              }}
            />
          )}
          {meta !== null && <RawSwitch raw={rawAll} onChange={session.setRaw} />}
        </div>
        {commentsOpen && (
          <ResizablePane pane="comments" edge="left" layout={paneLayout} otherOpen={outlineOpen ? 'outline' : folderOpen ? 'navigator' : null}>
          <CommentsSidebar
            threads={threads}
            selectedKey={selectedKey}
            onOpen={(key) => {
              setDraft(null);
              openThread(key);
            }}
            onClose={() => setSelectedKey(null)}
            draft={draft === null ? null : { anchor: draft.anchor }}
            canAdd={meta !== null && readOnlyPull === null && (liveSelection !== null || canAddAtCursor)}
            onAdd={addComment}
            onCancelDraft={() => setDraft(null)}
            onSubmitDraft={submitDraft}
            onReply={reply}
            onSetStatus={setStatus}
            onEdit={edit}
            onDelete={remove}
          />
          </ResizablePane>
        )}
      </div>
      {menu !== null && (
        <EditorContextMenu
          x={menu.x}
          y={menu.y}
          onClose={closeMenu}
          items={registry.resolveContextMenu(commandContext).map((e) => ({
            label: e.label,
            onSelect: () => void e.command.run?.(commandContext),
            disabled: !e.enabled,
            divider: e.divider,
          }))}
        />
      )}
      {liveSelection !== null && draft === null && (
        <button
          type="button"
          aria-label="Comment on selection"
          title="Add comment"
          // Keep the text selected while the button is pressed.
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => startDraft(liveSelection)}
          style={{ position: 'fixed', left: liveSelection.x, top: liveSelection.y }}
          className="z-10 cursor-pointer rounded-control border border-solid border-border bg-background px-1 py-0.5 text-sm leading-none shadow-sm"
        >
          💬
        </button>
      )}
      <DialogHost />
    </div>
  );
}
