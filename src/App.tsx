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
import { listThreads } from './components/threads';
import { isCommentableAt, selectionToRange, type ThreadTarget } from './components/newThread';
import { appendToThread, deleteThread, editThreadMessage, normalizeAnchor, setThreadStatus, openThread as openThreadIn, withAgentGuidance } from './comment-threads';
import { RawSwitch } from './components/RawSwitch';
import { MarkdownView } from './components/MarkdownView';
import { useDocument } from './document/useDocument';
import { files as defaultFiles, type FileAccess } from './platform/files';
import { guardClose } from './platform/lifecycle';
import { FolderSidebar } from './components/FolderSidebar';
import { foldersSupported, pathExists, pickFolder } from './platform/folders';
import { addRecent, allowRecentDocument, listRecents, removeRecent, type RecentDocument } from './platform/recents';

function parentDir(path: string): string | null {
  const i = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  if (i < 0) return null;
  return i === 0 ? path.slice(0, 1) : path.slice(0, i);
}

export default function App({ files = defaultFiles }: { files?: FileAccess }) {
  const session = useDocument();
  const { meta, text, dirty, region } = session;
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
  const [selection, setSelection] = useState<{ from: number; to: number; text: string; x: number; y: number } | null>(null);
  const [caret, setCaret] = useState<{ offset: number; text: string } | null>(null);
  const [reveal, setReveal] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ name: string; resolve: (c: UnsavedChoice) => void } | null>(null);
  const activeId = session.activeId;
  const [authorName, setAuthor] = useState(DEFAULT_AUTHOR);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [skillOpen, setSkillOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const threads = useMemo(() => (meta === null ? [] : listThreads(text)), [meta, text]);
  const outline = useMemo(() => (outlineOpen && meta !== null ? outlineOf(text) : []), [outlineOpen, meta, text]);
  const doc = useMemo(() => (meta === null ? null : { name: meta.name, path: meta.path, text }), [meta, text]);

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
    const parent = parentDir(docPath);
    if (parent !== null) setFolder(parent);
  }, [docPath]);
  const remember = useCallback((path: string | null) => {
    if (path !== null) addRecent(path).then(setRecents, () => {});
  }, []);

  // Switching tabs: the comments sidebar goes back to All threads, and the canvas gets its scroll back.
  useEffect(() => {
    setSelectedKey(null);
    setDraft(null);
    setSelection(null);
    setCaret(null);
    setError(null);
  }, [activeId]);
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = session.activeTab?.scrollTop ?? 0;
    // Only a switch restores scroll; ordinary edits keep the canvas where it is.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const textRef = useRef(text);
  textRef.current = text;
  const liveSelection = selection !== null && selection.text === text ? selection : null;
  const liveCaret = caret !== null && caret.text === text ? caret.offset : null;
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
        session.replaceText(next);
        const created = listThreads(next).find((t) => t.thread.id === thread.id);
        setError(null);
        setDraft(null);
        setSelection(null);
        window.getSelection()?.removeAllRanges();
        if (created) {
          setSelectedKey(created.key);
          setReveal(created.key);
        }
      } catch (e) {
        failed(e);
      }
    },
    [draft, text, authorName, session.replaceText],
  );

  const reply = useCallback(
    (key: string, body: string) => {
      const item = threads.find((t) => t.key === key);
      if (item === undefined || body.trim() === '') return;
      try {
        session.replaceText(appendToThread(text, { id: item.thread.id, ordinal: item.ordinal }, authorName, body.trim()));
        setError(null);
      } catch (e) {
        failed(e);
      }
    },
    [threads, text, authorName, session.replaceText],
  );

  const setStatus = useCallback(
    (key: string, status: 'open' | 'resolved') => {
      const item = threads.find((t) => t.key === key);
      if (item === undefined) return;
      try {
        session.replaceText(setThreadStatus(text, { id: item.thread.id, ordinal: item.ordinal }, status));
        setError(null);
      } catch (e) {
        failed(e);
      }
    },
    [threads, text, session.replaceText],
  );

  const edit = useCallback(
    (key: string, body: string) => {
      const item = threads.find((t) => t.key === key);
      if (item === undefined || body.trim() === '') return;
      try {
        session.replaceText(editThreadMessage(text, { id: item.thread.id, ordinal: item.ordinal }, body.trim()));
        setError(null);
      } catch (e) {
        failed(e);
      }
    },
    [threads, text, session.replaceText],
  );

  const remove = useCallback(
    (key: string) => {
      const item = threads.find((t) => t.key === key);
      if (item === undefined) return;
      try {
        session.replaceText(deleteThread(text, { id: item.thread.id, ordinal: item.ordinal }));
        setError(null);
        setSelectedKey(null);
      } catch (e) {
        failed(e);
      }
    },
    [threads, text, session.replaceText],
  );

  // Once the new marker is rendered, bring it into view.
  useEffect(() => {
    if (reveal === null) return;
    const main = mainRef.current;
    const marker = main?.querySelector<HTMLElement>(`[data-thread-key="${CSS.escape(reveal)}"]`);
    if (main && marker) main.scrollTop += marker.getBoundingClientRect().top - main.getBoundingClientRect().top - 40;
    setReveal(null);
  }, [reveal, text]);

  const toggleComments = useCallback(() => {
    // Each reopen starts at the All threads list.
    setSelectedKey(null);
    setDraft(null);
    setCommentsOpen((open) => !open);
  }, []);

  // A selection inside one paragraph or task item offers a comment button next to it.
  useEffect(() => {
    const onChange = () => {
      const article = mainRef.current?.querySelector('[data-testid="markdown-view"]');
      const sel = window.getSelection();
      const range = article && sel ? selectionToRange(article, sel, textRef.current) : null;
      if (!range || !sel) return setSelection(null);
      const box = sel.getRangeAt(0).getBoundingClientRect?.() ?? { right: 0, top: 0 };
      setSelection({ ...range, text: textRef.current, x: box.right + 4, y: Math.max(0, box.top - 30) });
    };
    document.addEventListener('selectionchange', onChange);
    return () => document.removeEventListener('selectionchange', onChange);
  }, []);

  const openThread = useCallback((key: string) => {
    setSelectedKey(key);
    setCommentsOpen(true);
    // A thread with no marker in the view has nothing to scroll to.
    const main = mainRef.current;
    const marker = main?.querySelector<HTMLElement>(`[data-thread-key="${CSS.escape(key)}"]`);
    if (main && marker) {
      main.scrollTop += marker.getBoundingClientRect().top - main.getBoundingClientRect().top - 40;
    }
  }, []);

  const jumpToHeading = useCallback((from: number) => {
    const main = mainRef.current;
    const heading = main?.querySelector<HTMLElement>(`:is(h1,h2,h3,h4,h5,h6)[data-from="${from}"]`);
    if (main && heading) main.scrollTop += heading.getBoundingClientRect().top - main.getBoundingClientRect().top - 20;
  }, []);

  const failed = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  /** Writes tab `id`; true when it is on disk, false when cancelled or failed. */
  const write = useCallback(
    async (id: number, as: boolean): Promise<boolean> => {
      const tab = session.peek(id);
      if (tab === null) return true;
      // What is written is what is marked saved, even if typing continues meanwhile.
      const snapshot = tab.text;
      // Save As may not land on a file another tab holds.
      const taken = (path: string) => session.peekTabs().some((t) => t.id !== id && t.path === path);
      try {
        const saved = as
          ? await files.saveDocumentAs({ name: tab.meta.name, text: snapshot }, taken)
          : tab.meta.path === null
            ? await files.saveDocument({ name: tab.meta.name, path: null, text: snapshot }, taken)
            : await files.saveDocument({ name: tab.meta.name, path: tab.meta.path, text: snapshot });
        if (saved === null) return false;
        if (saved.path !== null && saved.path !== tab.meta.path && taken(saved.path)) {
          setError(`${saved.path} is already open in another tab, so it was not saved there. Choose another name.`);
          return false;
        }
        setError(null);
        session.saved(id, saved, snapshot);
        if (saved.path !== tab.meta.path) remember(saved.path);
        return true;
      } catch (e) {
        failed(e);
        return false;
      }
    },
    [files, session.peek, session.peekTabs, session.saved, remember],
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
          if (!(await pathExists(path))) {
            await removeRecent(path).then(setRecents, () => {});
            return setError(`${path} no longer exists, so it was removed from recent documents.`);
          }
        }
        const opened = await files.openPath(path);
        setError(null);
        session.open(opened);
        remember(opened.path);
      } catch (e) {
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

  // Keyboard shortcuts read the latest handlers through a ref, so the listener is added once.
  const openPrefs = useCallback(() => setPrefsOpen(true), []);
  const actions = useRef({ newFile, openFile, save, saveAs, undo: session.undo, redo: session.redo, openPrefs });
  actions.current = { newFile, openFile, save, saveAs, undo: session.undo, redo: session.redo, openPrefs };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const a = actions.current;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      // Undo in any other text field is that field's own.
      const foreignField = target?.closest('input, textarea') && !target.closest('[data-block-editor]');
      let run: (() => unknown) | null = null;
      if (e.key === ',' && !e.shiftKey) run = a.openPrefs;
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
        onOpenFolder={foldersSupported() ? () => void openFolder() : undefined}
        onSave={() => void save()}
        onSaveAs={() => void saveAs()}
        onUndo={session.undo}
        onRedo={session.redo}
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
            supported={foldersSupported()}
            folder={folder}
            recents={recents}
            currentPath={meta?.path ?? null}
            onOpenFolder={() => void openFolder()}
            onOpenFile={openFromFolder}
            onOpenRecent={(path) => void openKnownPath(path, true)}
            onRemoveRecent={(path) => void removeRecent(path).then(setRecents, () => {})}
          />
        )}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {doc !== null && (
            <EditToolbar editing={region !== null} canUndo={session.canUndo} canRedo={session.canRedo} onUndo={session.undo} onRedo={session.redo} />
          )}
          <main ref={mainRef} onScroll={(e) => session.setScrollTop(e.currentTarget.scrollTop)} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
            <div className="mx-auto box-border w-full max-w-[760px] px-10 pb-16 pt-5">
              {error !== null && (
                <div role="alert" className="mb-5 rounded-control border border-destructive px-3 py-2 text-[13px] text-destructive">
                  {error}
                </div>
              )}
              {doc !== null ? (
                <>
                  <MarkdownView
                    doc={doc}
                    files={files}
                    threads={threads}
                    onOpenThread={openThread}
                    editing={{
                      region,
                      onStart: session.startEdit,
                      onChange: session.changeEdit,
                      onCaret: (offset) =>
                        setCaret((c) => (c !== null && c.offset === offset && c.text === text ? c : { offset, text })),
                      onClose: session.closeEdit,
                      onToggleTask: session.replaceRange,
                      rawAll,
                    }}
                  />
                  {region === null && !rawAll && (
                    <div
                      data-testid="append-area"
                      className="min-h-24 cursor-text text-[13px] text-muted-foreground"
                      onClick={session.startAppend}
                    >
                      {text === '' && 'Click here to start writing.'}
                    </div>
                  )}
                </>
              ) : (
                error === null && (
                  <p className="text-[13px] text-muted-foreground">Use File &gt; Open to open a Markdown file, or File &gt; New to start one.</p>
                )
              )}
            </div>
          </main>
          {doc !== null && (
            <RawSwitch
              raw={rawAll}
              onChange={(raw) => {
                session.closeEdit();
                session.setRaw(raw);
              }}
            />
          )}
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
            onCancelDraft={() => {
              setDraft(null);
              window.getSelection()?.removeAllRanges();
            }}
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
      {asking !== null && <UnsavedChangesDialog name={asking.name} onChoose={asking.resolve} />}
    </div>
  );
}
