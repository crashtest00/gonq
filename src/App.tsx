import { useCallback, useEffect, useState } from 'react';
import { MenuBar } from './components/MenuBar';
import { TabStrip } from './components/TabStrip';
import { MarkdownView } from './components/MarkdownView';
import { files as defaultFiles, type FileAccess, type OpenedDocument } from './platform/files';

export default function App({ files = defaultFiles }: { files?: FileAccess }) {
  const [doc, setDoc] = useState<OpenedDocument | null>(null);
  const [error, setError] = useState<string | null>(null);

  const openFile = useCallback(async () => {
    try {
      const opened = await files.pickDocument();
      if (opened === null) return;
      setError(null);
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
      <TabStrip name={doc?.name ?? null} />
      <main className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto box-border w-full max-w-[760px] px-10 pb-16 pt-5">
          {error !== null && (
            <div role="alert" className="mb-5 rounded-control border border-destructive px-3 py-2 text-[13px] text-destructive">
              {error}
            </div>
          )}
          {doc !== null ? (
            <MarkdownView doc={doc} files={files} />
          ) : (
            error === null && <p className="text-[13px] text-muted-foreground">Use File &gt; Open to open a Markdown file.</p>
          )}
        </div>
      </main>
    </div>
  );
}
