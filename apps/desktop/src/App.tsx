/**
 * The app shell: owns the open tabs (useDocument), the one MarkdownEditor, the menu bar and toolbars, the
 * folder/outline/comments sidebars and <DialogHost/> (every dialog is opened with openDialog, see dialogs/), builds the CommandContext the command registry's menus and shortcuts run against, and wires its actions to platform/ calls (document open/save/close come from
 * useDocumentController and the GitHub flows (sign-in handler, Open Repo/PR, branches, commit, read-only) from useGithubController, which
 * get their dialogs injected here; connect, launch paths stay in this file). Errors land in its banner.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTheme } from '@gonq/editor/lib/useTheme';
import { MenuBar } from './components/MenuBar';
import { registry, type CommandContext } from '@gonq/editor/commands';
import { DialogHost, openDialog, type DialogRef } from '@gonq/editor/dialogs/DialogHost';
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
import { DEFAULT_AUTHOR, getAuthorName, setAuthorName } from '@gonq/editor/platform/settings';
import { TabStrip } from './components/TabStrip';
import { EditToolbar } from './components/EditToolbar';
import { EditorContextMenu } from './components/EditorContextMenu';
import { TableToolbar } from './components/TableToolbar';
import type { TableTarget } from '@gonq/editor/editor/tables';
import { ResizablePane } from './components/ResizablePane';
import { usePaneWidths } from './components/paneWidths';
import { OutlineSidebar } from './components/OutlineSidebar';
import { outlineOf } from '@gonq/editor/model/outline';
import { CommentsSidebar } from './components/CommentsSidebar';
import { isSshPath, remoteAccount, setConnectHandler } from '@gonq/editor/platform/remote';
import { parseGithubPath, signOut as githubSignOut, type GithubDocument } from '@gonq/editor/platform/github';
import { assertConnectAvailable } from '@gonq/editor/platform/connect';
import { listThreads, threadKey } from '@gonq/editor/model/threads';
import { isCommentableAt, selectionRange, type ThreadTarget } from '@gonq/editor/model/newThread';
import { parseCommentMarkers, appendToThread, deleteThread, editThreadMessage, normalizeAnchor, setThreadStatus } from '@gonq/editor/comment-threads';
import { RawSwitch } from './components/RawSwitch';
import { MarkdownEditor, type EditorHandle, type EditorSelection } from '@gonq/editor/editor/MarkdownEditor';
import { type DocumentMeta } from '@gonq/editor/document/useDocument';
import { files as defaultFiles, type FileAccess } from '@gonq/editor/platform/files';
import { useDocumentController } from '@gonq/editor/controllers/document';
import { pickImage } from '@gonq/editor/platform/images';
import { useGithubController } from '@gonq/editor/controllers/github';
import { ReadOnlyBanner } from './components/ReadOnlyBanner';
import { listenOpenPaths, takePendingOpenPaths } from '@gonq/editor/platform/openPaths';
import { FolderSidebar } from './components/FolderSidebar';
import { pickFolder } from '@gonq/editor/platform/folders';

function parentDir(path: string): string | null {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (i < 0) return null;
  return i === 0 ? path.slice(0, 1) : path.slice(0, i);
}

export default function App({ files = defaultFiles }: { files?: FileAccess }) {
  const [error, setError] = useState<string | null>(null);
  // A remote save slower than a second says where it is going; an in-place save says it was not atomic.
  const [savingTo, setSavingTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Save on a GitHub tab commits through commitGithub, defined below (it needs the session this returns).
  const commitGithubRef = useRef<(id: number, gh: GithubDocument, text: string, dirty: boolean, meta: DocumentMeta) => Promise<boolean>>();
  const signInRef = useRef<() => Promise<boolean>>();
  const doc = useDocumentController({
    files,
    confirmUnsaved: (name) => openDialog(unsavedChangesDialog, { name }),
    confirmConflict: (conflict) => openDialog(conflictDialog, conflict),
    commitGithub: (...args) => commitGithubRef.current!(...args),
    onError: setError,
    onNotice: setNotice,
    onSaving: setSavingTo,
  });
  const { session, recents, remember } = doc;
  const { meta, text } = session;
  const gh = useGithubController({
    session,
    dialogs: {
      signIn: () => signInRef.current!(),
      pickRepo: () => openDialog(repoPickerDialog, {}),
      confirmBranchChange: (name) => openDialog(branchChangeDialog, { name }),
      chooseCommit: (target) => openDialog(commitDialog, target),
      showConflict: (conflict) => openDialog(conflictDialog, conflict),
      createBranch: (args) => openDialog(createBranchDialog, args),
      openPr: (args) => openDialog(openPrDialog, args),
    },
    onError: setError,
    onNotice: setNotice,
    onRepoChosen: () => {
      folderChosen.current = true;
      setOutlineOpen(false);
      setFolderOpen(true);
    },
  });
  const { repo, setRepo, readOnlyPull } = gh;
  commitGithubRef.current = gh.commitGithub;
  const rawAll = session.raw;
  const [commentsOpen, setCommentsOpen] = useState(false);
  const paneLayout = usePaneWidths();
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  // Once the user picks a folder with Open Folder…, opening documents no longer moves the Project folder.
  const folderChosen = useRef(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ target: ThreadTarget; text: string; anchor?: string } | null>(null);
  const [tableTarget, setTableTarget] = useState<TableTarget | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const editor = useRef<EditorHandle>(null);
  const activeId = session.activeId;
  const [authorName, setAuthor] = useState(DEFAULT_AUTHOR);
  const [theme, setThemeChoice] = useTheme(useCallback((e: unknown) => setError(e instanceof Error ? e.message : String(e)), []));
  // Dialogs are opened through openDialog and shown by <DialogHost/>; see dialogs/dialogs.tsx.
  const threads = useMemo(() => (meta === null ? [] : listThreads(text)), [meta, text]);
  const outline = useMemo(() => (outlineOpen && meta !== null ? outlineOf(text) : []), [outlineOpen, meta, text]);

  useEffect(() => {
    let live = true;
    getAuthorName().then((n) => live && setAuthor(n));
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
    if (readOnlyPull !== null) return;
    if (draft !== null) {
      // A draft is already open: keep what was typed and focus it.
      document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Comment"]')?.focus();
      return;
    }
    if (liveSelection !== null) startDraft(liveSelection);
    else if (canAddAtCursor && liveCaret !== null) startDraft(liveCaret);
  }, [readOnlyPull, draft, liveSelection, canAddAtCursor, liveCaret, startDraft]);

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

  const openKnownPath = useCallback(
    (path: string, fromRecents: boolean) =>
      doc.openKnownPath(path, fromRecents, (github) => {
        // Reopening a GitHub recent shows its repository and branch in the navigator.
        setRepo((r) => (r !== null && r.owner === github.owner && r.repo === github.repo && r.branch === github.branch ? r : { owner: github.owner, repo: github.repo, branch: github.branch }));
        folderChosen.current = true;
        setFolderOpen(true);
      }),
    [doc.openKnownPath],
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
  // The sign-in handler itself (ensureSignedIn, one dialog at a time) lives in useGithubController; this opens the Settings dialog it asks for.
  signInRef.current = (): Promise<boolean> => {
    if (singles.current.has(settingsDialog.id)) return Promise.resolve(false);
    singles.current.add(settingsDialog.id);
    const asked = openDialog(settingsDialog, { authorName: authorNameRef.current, onSave: saveAuthor, startSignIn: true, onSignOut: doGithubSignOut });
    void asked.finally(() => singles.current.delete(settingsDialog.id));
    return asked;
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
    hasDocument: doc.hasDocument,
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
    save: () => void doc.save(),
    saveAs: () => void doc.saveAs(),
    isGithubTab: meta?.github !== undefined,
    readOnly: readOnlyPull !== null,
    commit: () => void doc.save(),
    newFile: doc.newFile,
    openFile: () => void doc.openFile(),
    closeTab: doc.closeTab,
    openFolder: () => void openFolder(),
    openConnect: () => void openConnect(),
    openRepo: () => void gh.openRepo(),
    canRefreshNavigator: folderOpen && (repo !== null || folder !== null),
    refreshNavigator: gh.refreshNavigator,
    canOpenPr: gh.canOpenPr,
    openPr: () => void gh.openPr(),
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

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background font-sans text-foreground">
      <MenuBar ctx={commandContext} />
      <TabStrip tabs={session.tabs} activeId={activeId} onSelect={(id) => {
        session.activate(id);
        editor.current?.focus();
      }} onClose={(id) => void doc.closeTabById(id)} onNew={doc.newFile} onMove={session.move} outlineOpen={outlineOpen} onToggleOutline={() => {
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
            createdBranches={gh.createdBranches.filter((b) => b.owner === repo?.owner && b.repo === repo?.repo).map((b) => b.branch)}
            refreshSignal={gh.navRefresh}
            onBranchChange={(branch) => void gh.changeBranch(branch)}
            onCreateBranch={gh.openCreateBranch}
            recents={recents}
            currentPath={meta?.path ?? null}
            onOpenFolder={() => void openFolder()}
            onOpenFile={openFromFolder}
            onLogin={(path) => openConnect(remoteAccount(path))}
            onOpenRecent={(path) => void openKnownPath(path, true)}
            onRemoveRecent={(path) => void doc.forgetRecent(path)}
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
            shortcut: e.shortcut,
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
