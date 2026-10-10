import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { MenuBar } from './components/MenuBar';
import { AgentSkillDialog } from './components/AgentSkillDialog';
import { AboutDialog } from './components/AboutDialog';
import { PreferencesDialog } from './components/PreferencesDialog';
import { DEFAULT_AUTHOR, getAuthorName, setAuthorName } from './platform/settings';
import { TabStrip } from './components/TabStrip';
import { EditToolbar } from './components/EditToolbar';
import { OutlineSidebar } from './components/OutlineSidebar';
import { outlineOf } from './components/outline';
import { CommentsSidebar } from './components/CommentsSidebar';
import { UnsavedChangesDialog, type UnsavedChoice } from './components/UnsavedChangesDialog';
import { ConflictDialog, type ConflictChoice } from './components/ConflictDialog';
import { RemoteConflictError, RemoteFileError, isSshPath, remoteAccount, remoteHost, setConnectHandler } from './platform/remote';
import { ConnectDialog } from './components/ConnectDialog';
import { assertConnectAvailable } from './platform/connect';
import { listThreads } from './components/threads';
import { isCommentableAt, selectionRange, type ThreadTarget } from './components/newThread';
import { parseCommentMarkers, appendToThread, deleteThread, editThreadMessage, normalizeAnchor, setThreadStatus, openThread as openThreadIn, withAgentGuidance } from './comment-threads';
import { RawSwitch } from './components/RawSwitch';
import { MarkdownEditor, type EditorHandle, type EditorSelection } from './editor/MarkdownEditor';
import { useDocument } from './document/useDocument';
import { files as defaultFiles, type FileAccess } from './platform/files';
import { guardClose } from './platform/lifecycle';
import { FolderSidebar } from './components/FolderSidebar';
import { pathExists, pickFolder } from './platform/folders';
import { addRecent, allowRecentDocument, listRecents, removeRecent, type RecentDocument } from './platform/recents';

function parentDir(path: string): string | null {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (i < 0) return null;
  return i === 0 ? path.slice(0, 1) : path.slice(0, i);
}

interface ConnectRequest {
  id: number;
  host?: string;
  reconnect: boolean;
  resolve: (connected: boolean) => void;
}

export default function App({ files = defaultFiles }: { files?: FileAccess }) {
  const session = useDocument();
  const { meta, text } = session;
  const rawAll = session.raw;
  const [error, setError] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [outlineOpen, setOutlineOpen] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [folder, setFolder] = useState<string | null>(null);
  // Once the user picks a folder with Open Folder…, opening documents no longer moves the Project folder.
  const folderChosen = useRef(false);
  const [recents, setRecents] = useState<RecentDocument[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [draft, setDraft] = useState<{ target: ThreadTarget; text: string; anchor?: string } | null>(null);
  const [selection, setSelection] = useState<EditorSelection | null>(null);
  const [caret, setCaret] = useState<number | null>(null);
  const editor = useRef<EditorHandle>(null);
  const [asking, setAsking] = useState<{ name: string; resolve: (c: UnsavedChoice) => void } | null>(null);
  const [conflict, setConflict] = useState<{ name: string; deleted: boolean; resolve: (c: ConflictChoice) => void } | null>(null);
  // A remote save slower than a second says where it is going; an in-place save says it was not atomic.
  const [savingTo, setSavingTo] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const activeId = session.activeId;
  const [authorName, setAuthor] = useState(DEFAULT_AUTHOR);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  // The Connect dialog: from File > Connect to Server, from a login a save or expand needs, or from an error row.
  const [connecting, setConnecting] = useState<ConnectRequest | null>(null);
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
    if (isSshPath(docPath)) return;
    const parent = parentDir(docPath);
    if (parent !== null) setFolder(parent);
  }, [docPath]);
  const remember = useCallback((path: string | null) => {
    if (path !== null) addRecent(path).then(setRecents, () => {});
  }, []);

  // Switching tabs: the comments sidebar goes back to All threads.
  useEffect(() => {
    setSelectedKey(null);
    setDraft(null);
    setSelection(null);
    setCaret(null);
    setError(null);
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
        const opened = openThreadIn(text, draft.target, authorName, body.trim());
        const { thread } = opened;
        // The note for agents goes just ahead of the new block, once per file.
        const next = withAgentGuidance(opened.doc, thread.from);
        editor.current?.setText(next);
        const created = listThreads(next).find((t) => t.thread.id === thread.id);
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

  /** Writes tab `id`; true when it is on disk, false when cancelled or failed. */
  const doWrite = useCallback(
    async (id: number, as: boolean): Promise<boolean> => {
      const tab = session.peek(id);
      if (tab === null) return true;
      // What is written is what is marked saved, even if typing continues meanwhile.
      const snapshot = tab.text;
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
            const choice = await new Promise<ConflictChoice>((resolve) => setConflict({ name: e.name_, deleted: e.deleted, resolve }));
            setConflict(null);
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
    [files, session.peek, session.peekTabs, session.saved, remember],
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
      const choice = await new Promise<UnsavedChoice>((resolve) => setAsking({ name: tab.meta.name, resolve }));
      setAsking(null);
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
      // A file that is already open is shown as it is, unsaved changes and all.
      const existing = session.findByPath(path);
      if (existing !== null) return session.activate(existing);
      try {
        if (fromRecents) {
          await allowRecentDocument(path);
          // A remote file stays in the list when its host is unreachable; opening it reports why.
          if (!isSshPath(path) && !(await pathExists(path))) {
            await removeRecent(path).then(setRecents, () => {});
            return setError(`${path} no longer exists, so it was removed from recent documents.`);
          }
        }
        const opened = await files.openPath(path);
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

  const openFromFolder = useCallback((path: string) => void openKnownPath(path, false), [openKnownPath]);

  const openFolder = useCallback(async () => {
    try {
      const picked = await pickFolder();
      if (picked === null) return;
      folderChosen.current = true;
      setFolder(picked);
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
  // One Connect dialog at a time. Each request gets its own key so its dialog starts fresh; requests that
  // arrive while one is open wait their turn and start only after it closes.
  const connectingNow = useRef<ConnectRequest | null>(null);
  const connectQueue = useRef<ConnectRequest[]>([]);
  const connectSeq = useRef(0);
  const requestConnect = useCallback((host: string | undefined, reconnect: boolean): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      const req: ConnectRequest = { id: ++connectSeq.current, host, reconnect, resolve };
      if (connectingNow.current === null) {
        connectingNow.current = req;
        setConnecting(req);
      } else connectQueue.current.push(req);
    });
  }, []);
  const connectClosed = useCallback((connected: boolean) => {
    connectingNow.current?.resolve(connected);
    const next = connectQueue.current.shift() ?? null;
    connectingNow.current = next;
    setConnecting(next);
  }, []);
  /** File > Connect to Server; does nothing while a Connect dialog is already open. */
  const openConnect = useCallback((host?: string): Promise<boolean> => {
    try {
      assertConnectAvailable();
    } catch (e) {
      failed(e);
      return Promise.resolve(false);
    }
    if (connectingNow.current !== null) return Promise.resolve(false);
    return requestConnect(host, false);
  }, [requestConnect]);
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
    setError(null);
    setOutlineOpen(false);
    setFolderOpen(true);
  }, []);

  // Keyboard shortcuts read the latest handlers through a ref, so the listener is added once.
  const openPrefs = useCallback(() => setPrefsOpen(true), []);
  const undo = useCallback(() => editor.current?.undo(), []);
  const redo = useCallback(() => editor.current?.redo(), []);
  const actions = useRef({ newFile, openFile, save, saveAs, undo, redo, openPrefs, openConnect });
  actions.current = { newFile, openFile, save, saveAs, undo, redo, openPrefs, openConnect };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const a = actions.current;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      // Undo in the editor is CodeMirror's own, as it is in any other text field.
      const foreignField = target?.closest('input, textarea, .cm-editor');
      let run: (() => unknown) | null = null;
      if (e.key === ',' && !e.shiftKey) run = a.openPrefs;
      else if (key === 'k' && e.shiftKey) run = () => a.openConnect();
      else if (key === 'o') run = a.openFile;
      else if (key === 'n') run = a.newFile;
      else if (key === 's') run = e.shiftKey ? a.saveAs : a.save;
      else if (!foreignField && key === 'z') run = e.shiftKey ? a.redo : a.undo;
      else if (!foreignField && key === 'y') run = a.redo;
      if (run === null) return;
      e.preventDefault();
      void run();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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
      <MenuBar
        hasDocument={meta !== null}
        canUndo={session.canUndo}
        canRedo={session.canRedo}
        onNew={newFile}
        onCloseTab={activeId === null ? undefined : () => void closeTab(activeId)}
        onOpen={() => void openFile()}
        onOpenFolder={() => void openFolder()}
        onConnect={() => void openConnect()}
        onSave={() => void save()}
        onSaveAs={() => void saveAs()}
        onUndo={undo}
        onRedo={redo}
        onPreferences={openPrefs}
        onAgentSkill={() => setSkillOpen(true)}
        onAbout={() => setAboutOpen(true)}
      />
      <TabStrip tabs={session.tabs} activeId={activeId} onSelect={session.activate} onClose={(id) => void closeTab(id)} onNew={newFile} outlineOpen={outlineOpen} onToggleOutline={() => {
          setOutlineOpen((o) => !o);
          setFolderOpen(false);
        }} folderOpen={folderOpen} onToggleFolder={() => {
          setFolderOpen((o) => !o);
          setOutlineOpen(false);
        }} commentsOpen={commentsOpen} onToggleComments={toggleComments} />
      <div className="flex min-h-0 flex-1">
        {outlineOpen && <OutlineSidebar items={outline} onJump={jumpToHeading} />}
        {folderOpen && (
          <FolderSidebar
            folder={folder}
            recents={recents}
            currentPath={meta?.path ?? null}
            onOpenFolder={() => void openFolder()}
            onOpenFile={openFromFolder}
            onLogin={(path) => openConnect(remoteAccount(path))}
            onOpenRecent={(path) => void openKnownPath(path, true)}
            onRemoveRecent={(path) => void removeRecent(path).then(setRecents, () => {})}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {meta !== null && <EditToolbar canUndo={session.canUndo} canRedo={session.canRedo} onUndo={undo} onRedo={redo} onFormat={(f, url) => editor.current?.format(f, url)} />}
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
              {meta === null && error === null && (
                <p className="text-[13px] text-muted-foreground">Use File &gt; Open to open a Markdown file, or File &gt; New to start one.</p>
              )}
            </div>
          )}
          {meta !== null && activeId !== null && (
            <MarkdownEditor
              ref={editor}
              tabId={activeId}
              text={text}
              raw={rawAll}
              tabIds={session.tabIds}
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
          <CommentsSidebar
            threads={threads}
            selectedKey={selectedKey}
            onOpen={(key) => {
              setDraft(null);
              openThread(key);
            }}
            onClose={() => setSelectedKey(null)}
            draft={draft === null ? null : { anchor: draft.anchor }}
            canAdd={meta !== null && (liveSelection !== null || canAddAtCursor)}
            onAdd={addComment}
            onCancelDraft={() => setDraft(null)}
            onSubmitDraft={submitDraft}
            onReply={reply}
            onSetStatus={setStatus}
            onEdit={edit}
            onDelete={remove}
          />
        )}
      </div>
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
      {prefsOpen && (
        <PreferencesDialog
          authorName={authorName}
          onSave={async (n) => setAuthor(await setAuthorName(n))}
          onClose={() => setPrefsOpen(false)}
        />
      )}
      {skillOpen && <AgentSkillDialog files={files} onClose={() => setSkillOpen(false)} />}
      {aboutOpen && <AboutDialog onClose={() => setAboutOpen(false)} />}
      {connecting !== null && (
        <ConnectDialog
          key={connecting.id}
          host={connecting.host}
          reconnect={connecting.reconnect}
          inUse={hostInUse}
          onOpened={openedRemoteFolder}
          onClose={connectClosed}
        />
      )}
      {conflict !== null && <ConflictDialog name={conflict.name} deleted={conflict.deleted} onChoose={conflict.resolve} />}
      {asking !== null && <UnsavedChangesDialog name={asking.name} onChoose={asking.resolve} />}
    </div>
  );
}
