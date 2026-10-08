import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MenuBar } from './components/MenuBar';
import { TabStrip } from './components/TabStrip';
import { EditToolbar } from './components/EditToolbar';
import { CommentsSidebar } from './components/CommentsSidebar';
import { UnsavedChangesDialog, type UnsavedChoice } from './components/UnsavedChangesDialog';
import { listThreads } from './components/threads';
import { MarkdownView } from './components/MarkdownView';
import { useDocument } from './document/useDocument';
import { files as defaultFiles, type FileAccess } from './platform/files';
import { guardClose } from './platform/lifecycle';

const UNTITLED = 'Untitled.md';

export default function App({ files = defaultFiles }: { files?: FileAccess }) {
  const session = useDocument();
  const { meta, text, dirty, region } = session;
  const [error, setError] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [asking, setAsking] = useState<{ name: string; resolve: (c: UnsavedChoice) => void } | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const threads = useMemo(() => (meta === null ? [] : listThreads(text)), [meta, text]);
  const doc = useMemo(() => (meta === null ? null : { name: meta.name, path: meta.path, text }), [meta, text]);

  const toggleComments = useCallback(() => {
    // Each reopen starts at the All threads list.
    setSelectedKey(null);
    setCommentsOpen((open) => !open);
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

  const failed = (e: unknown) => setError(e instanceof Error ? e.message : String(e));

  /** Writes the document; true when it is on disk, false when cancelled or failed. */
  const write = useCallback(
    async (as: boolean): Promise<boolean> => {
      if (meta === null) return true;
      // What is written is what is marked saved, even if typing continues meanwhile.
      const snapshot = text;
      try {
        const saved = as
          ? await files.saveDocumentAs({ name: meta.name, text: snapshot })
          : await files.saveDocument({ name: meta.name, path: meta.path, text: snapshot });
        if (saved === null) return false;
        setError(null);
        session.saved(saved, snapshot);
        return true;
      } catch (e) {
        failed(e);
        return false;
      }
    },
    [files, meta, text, session.saved],
  );
  const save = useCallback(() => write(false), [write]);
  const saveAs = useCallback(() => write(true), [write]);

  /** Resolves true when it is fine to replace or close the document: saved, discarded or clean. */
  const confirmDiscard = useCallback(async (): Promise<boolean> => {
    if (meta === null || !dirty) return true;
    const choice = await new Promise<UnsavedChoice>((resolve) => setAsking({ name: meta.name, resolve }));
    setAsking(null);
    if (choice === 'save') return save();
    return choice === 'discard';
  }, [meta, dirty, save]);

  const newFile = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    setError(null);
    setSelectedKey(null);
    session.load({ name: UNTITLED, path: null, text: '' });
  }, [confirmDiscard, session.load]);

  const openFile = useCallback(async () => {
    if (!(await confirmDiscard())) return;
    try {
      const opened = await files.pickDocument();
      if (opened === null) return;
      setError(null);
      setSelectedKey(null);
      session.load(opened);
    } catch (e) {
      // A file that cannot be opened leaves whatever is already open untouched.
      failed(e);
    }
  }, [files, confirmDiscard, session.load]);

  // Keyboard shortcuts read the latest handlers through a ref, so the listener is added once.
  const actions = useRef({ newFile, openFile, save, saveAs, undo: session.undo, redo: session.redo });
  actions.current = { newFile, openFile, save, saveAs, undo: session.undo, redo: session.redo };
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
      const a = actions.current;
      const key = e.key.toLowerCase();
      const target = e.target as HTMLElement | null;
      // Undo in any other text field is that field's own.
      const foreignField = target?.closest('input, textarea') && !target.closest('[data-block-editor]');
      let run: (() => unknown) | null = null;
      if (key === 'o') run = a.openFile;
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
  const guard = useRef({ dirty, confirmDiscard });
  guard.current = { dirty, confirmDiscard };
  useEffect(() => guardClose(() => guard.current.dirty, () => guard.current.confirmDiscard()), []);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background font-sans text-foreground">
      <MenuBar
        hasDocument={meta !== null}
        canUndo={session.canUndo}
        canRedo={session.canRedo}
        onNew={() => void newFile()}
        onOpen={() => void openFile()}
        onSave={() => void save()}
        onSaveAs={() => void saveAs()}
        onUndo={session.undo}
        onRedo={session.redo}
      />
      <TabStrip name={meta?.name ?? null} dirty={dirty} commentsOpen={commentsOpen} onToggleComments={toggleComments} />
      <div className="flex min-h-0 flex-1">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {doc !== null && (
            <EditToolbar canUndo={session.canUndo} canRedo={session.canRedo} onUndo={session.undo} onRedo={session.redo} />
          )}
          <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
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
                      onClose: session.closeEdit,
                    }}
                  />
                  {region === null && (
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
        </div>
        {commentsOpen && (
          <CommentsSidebar threads={threads} selectedKey={selectedKey} onOpen={openThread} onClose={() => setSelectedKey(null)} />
        )}
      </div>
      {asking !== null && <UnsavedChangesDialog name={asking.name} onChoose={asking.resolve} />}
    </div>
  );
}
