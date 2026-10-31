/**
 * The mobile folder state (M-31): <FolderProvider/> holds the opened local folder (the navigator root, a local:// path),
 * whether the Folder navigator sheet is open, and the Save as name prompt, and useFolder() hands them to screens.
 * openFolder() runs the system folder picker through the platform layer (cancel returns silently, a failure goes to the
 * error banner) and adds the folder to recents as local://; openFolderPath(recent) reopens one after checking the grant and
 * the root (a revoked or missing one removes the recent and shows the platform's text in the banner, no dialog);
 * verify() is that same check for Refresh. It also fills the document session's local Save as hooks (current folder, name
 * prompt) and renders the FolderSheet and the SaveAsSheet, outside the command registry.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { SavedDocument } from '@gonq/editor/platform/files';
import { LocalFileError, checkLocalRoot, localPath, localTreeName, parseLocalPath, pickLocalFolder } from '@gonq/editor/platform/local';
import { FolderSheet } from '../screens/FolderSheet';
import { SaveAsSheet, type SaveAsRequest } from '../screens/SaveAsSheet';
import { useDocuments, useLocalSaveRef } from './documents';
import { useNotices } from './notices';

export interface FolderState {
  /** The opened folder's local:// path (its root), or null with nothing open. */
  folder: string | null;
  /** The folder's base name only, never a path. */
  name: string | null;
  sheetOpen: boolean;
  openSheet(): void;
  closeSheet(): void;
  /** Open Folder…: the system picker; resolves when the folder is open or the user cancelled. */
  openFolder(): Promise<void>;
  /** Reopens a folder from the recent list. */
  openFolderPath(path: string): Promise<void>;
  /** Whether the opened folder is still granted and there; if not the banner says why, the recent is removed and the folder is closed. */
  verify(): Promise<boolean>;
}

const FolderContext = createContext<FolderState | null>(null);

export function useFolder(): FolderState {
  const ctx = useContext(FolderContext);
  if (!ctx) throw new Error('useFolder needs a <FolderProvider>');
  return ctx;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function FolderProvider({ children }: { children: ReactNode }) {
  const { setError } = useNotices();
  const doc = useDocuments();
  const localSave = useLocalSaveRef();
  const [folder, setFolder] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [prompt, setPrompt] = useState<(SaveAsRequest & { resolve(r: SavedDocument | null): void; reject(e: unknown): void }) | null>(null);

  const name = folder === null ? null : (() => {
    const h = parseLocalPath(folder);
    return h === null ? null : localTreeName(h.tree);
  })();

  const opened = useCallback(
    (path: string) => {
      setFolder(path);
      setError(null);
      setSheetOpen(true);
      doc.remember(path);
    },
    [setError, doc.remember],
  );

  const openFolder = useCallback(async () => {
    try {
      const picked = await pickLocalFolder();
      if (picked === null) return;
      opened(localPath(picked.handle));
    } catch (e) {
      setError(messageOf(e));
    }
  }, [opened, setError]);

  /** Checks `path` (grant and root); on failure shows the platform's text, removes the recent and closes the folder. */
  const check = useCallback(
    async (path: string): Promise<boolean> => {
      try {
        await checkLocalRoot(path);
        return true;
      } catch (e) {
        setError(messageOf(e));
        if (!(e instanceof LocalFileError && e.kind === 'unsupported')) await doc.forgetRecent(path);
        setFolder((f) => (f === path ? null : f));
        setSheetOpen(false);
        return false;
      }
    },
    [setError, doc.forgetRecent],
  );

  const openFolderPath = useCallback(
    async (path: string) => {
      if (await check(path)) opened(path);
    },
    [check, opened],
  );

  const folderRef = useRef(folder);
  folderRef.current = folder;
  const verify = useCallback(async () => (folderRef.current === null ? false : check(folderRef.current)), [check]);

  // The document session's Save as asks the folder state where "the current folder" is and for a file name.
  const metaPath = doc.session.meta?.path ?? null;
  const pathRef = useRef(metaPath);
  pathRef.current = metaPath;
  useEffect(() => {
    localSave.current = {
      currentFolder() {
        const root = folderRef.current;
        if (root === null) return null;
        const rootHandle = parseLocalPath(root);
        if (rootHandle === null) return null;
        // A document inside the folder saves next to itself; any other document saves in the folder's root.
        const docHandle = pathRef.current === null ? null : parseLocalPath(pathRef.current);
        if (docHandle !== null && docHandle.tree === rootHandle.tree) {
          const parent = docHandle.rel.split('/').filter(Boolean).slice(0, -1);
          const dir = { tree: rootHandle.tree, rel: parent.join('/') };
          return { path: localPath(dir), name: parent.length === 0 ? localTreeName(rootHandle.tree) : parent[parent.length - 1] };
        }
        return { path: root, name: localTreeName(rootHandle.tree) };
      },
      promptName: (request) => new Promise((resolve, reject) => setPrompt({ ...request, resolve, reject })),
    };
    return () => {
      localSave.current = null;
    };
  }, [localSave]);

  const value = useMemo<FolderState>(
    () => ({
      folder,
      name,
      sheetOpen,
      openSheet: () => setSheetOpen(true),
      closeSheet: () => setSheetOpen(false),
      openFolder,
      openFolderPath,
      verify,
    }),
    [folder, name, sheetOpen, openFolder, openFolderPath, verify],
  );
  return (
    <FolderContext.Provider value={value}>
      {children}
      <FolderSheet />
      {prompt !== null && (
        <SaveAsSheet
          request={prompt}
          onDone={(saved) => {
            setPrompt(null);
            prompt.resolve(saved);
          }}
          onFail={(e) => {
            setPrompt(null);
            prompt.reject(e);
          }}
        />
      )}
    </FolderContext.Provider>
  );
}
