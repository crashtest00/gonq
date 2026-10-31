/**
 * mobileFiles(base, hooks): the mobile document session's FileAccess. It is the platform `files` plus Save as for the
 * Gonq Android app (the only place a local:// folder exists): with a folder open, Save as asks for a name (hooks.promptName)
 * and creates the file in the current folder through createLocal, `exists` answered inside the prompt; with no folder open it
 * uses the system create-document picker (createLocalDocument) and writes into the document it returns. A document with no
 * path saves the same way. Everything else, and every other platform (the browser download, desktop dialogs), is `base`.
 */
import type { MutableRefObject } from 'react';
import type { FileAccess, PathTaken, SavedDocument } from '@gonq/editor/platform/files';
import { PathTakenError } from '@gonq/editor/platform/files';
import {
  LocalFileError,
  childHandle,
  createLocal,
  createLocalDocument,
  localFileName,
  localPath,
  localReachable,
  parseLocalPath,
  writeLocal,
} from '@gonq/editor/platform/local';

/** What the folder state hands the file layer: where "the current folder" is, and the name prompt. */
export interface LocalSaveHooks {
  /** The folder Save as writes into: the opened folder, or the subfolder the active document is in; null with no folder open. */
  currentFolder(): { path: string; name: string } | null;
  /**
   * Asks for a file name and calls `create` with it; a LocalFileError of kind `exists` is shown in the prompt and it asks again.
   * Resolves what `create` resolved, or null when the user cancels. Any other failure rejects.
   */
  promptName(request: { suggested: string; folderName: string; create(name: string): Promise<SavedDocument> }): Promise<SavedDocument | null>;
}

/** "Untitled" is saved as "Untitled.md"; a name that is already .md or .markdown stays. */
export const withMarkdownExtension = (name: string): string => (/\.(md|markdown)$/i.test(name) ? name : `${name}.md`);

/** Why `name` cannot be a file name in a folder, or null. */
export function fileNameProblem(name: string): string | null {
  const n = name.trim();
  if (n === '') return 'Enter a name';
  if (/[\\/]/.test(n)) return 'A name cannot contain “/” or “\\”';
  if (n === '.' || n === '..' || n.startsWith('.')) return 'A name cannot start with “.”';
  return null;
}

export function mobileFiles(base: FileAccess, hooks: MutableRefObject<LocalSaveHooks | null>): FileAccess {
  async function saveAs(doc: { name: string; text: string }, taken?: PathTaken): Promise<SavedDocument | null> {
    const h = hooks.current;
    if (h === null || !localReachable()) return base.saveDocumentAs(doc, taken);
    const suggested = withMarkdownExtension(doc.name);
    const folder = h.currentFolder();
    if (folder === null) {
      const made = await createLocalDocument(suggested);
      if (made === null) return null;
      const local = await writeLocal(made.handle, doc.text);
      return { name: made.name, path: localPath(made.handle), local };
    }
    const dir = parseLocalPath(folder.path);
    if (dir === null) throw new LocalFileError('not-found', `${folder.name} is not a folder on this device.`);
    return h.promptName({
      suggested,
      folderName: folder.name,
      create: async (typed) => {
        const handle = childHandle(dir, withMarkdownExtension(typed.trim()));
        const path = localPath(handle);
        // Refused before anything is written, so the other tab's file is never touched.
        if (taken?.(path)) throw new PathTakenError(path);
        const local = await createLocal(handle, doc.text);
        return { name: localFileName(path), path, local };
      },
    });
  }
  return {
    ...base,
    saveDocumentAs: saveAs,
    saveDocument: (doc, taken, options) => (doc.path === null ? saveAs(doc, taken) : base.saveDocument(doc, taken, options)),
  };
}
