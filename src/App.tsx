import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { MenuBar } from './components/MenuBar';
import { TabStrip } from './components/TabStrip';
import { CommentsSidebar } from './components/CommentsSidebar';
import { listThreads } from './components/threads';
import { MarkdownView } from './components/MarkdownView';
import { files as defaultFiles, type FileAccess, type OpenedDocument } from './platform/files';

export default function App({ files = defaultFiles }: { files?: FileAccess }) {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const mainRef = useRef<HTMLElement>(null);
  const threads = useMemo(() => (doc === null ? [] : listThreads(doc.text)), [doc]);

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

  const openFile = useCallback(async () => {
    try {
      const opened = await files.pickDocument();
      if (opened === null) return;
      setError(null);
      setSelectedKey(null);
      setDoc(opened);
    } catch (e) {
      // A file that cannot be opened leaves whatever is already open untouched.
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [files]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'o') {
        e.preventDefault();
        void openFile();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openFile]);

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background font-sans text-foreground">
      <MenuBar onOpen={() => void openFile()} />
      <TabStrip name={doc?.name ?? null} commentsOpen={commentsOpen} onToggleComments={toggleComments} />
      <div className="flex min-h-0 flex-1">
        <main ref={mainRef} className="min-h-0 min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto box-border w-full max-w-[760px] px-10 pb-16 pt-5">
            {error !== null && (
              <div role="alert" className="mb-5 rounded-control border border-destructive px-3 py-2 text-[13px] text-destructive">
                {error}
              </div>
            )}
            {doc !== null ? (
              <MarkdownView doc={doc} files={files} threads={threads} onOpenThread={openThread} />
            ) : (
              error === null && <p className="text-[13px] text-muted-foreground">Use File &gt; Open to open a Markdown file.</p>
            )}
          </div>
        </main>
        {commentsOpen && (
          <CommentsSidebar threads={threads} selectedKey={selectedKey} onOpen={openThread} onClose={() => setSelectedKey(null)} />
        )}
      </div>
    </div>
  );
}
