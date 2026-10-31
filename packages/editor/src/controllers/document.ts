/**
 * useDocumentController: the document session shared by every shell (desktop today, mobile next). Owns the
 * open tabs (useDocument), New, Open, Open from a recent or the navigator, Save, Save As, the unsaved-changes
 * guard on closing a tab or the window (platform/lifecycle.ts) and the save-conflict decision. It renders no
 * dialogs: the shell injects `confirmUnsaved` and `confirmConflict` as async callbacks and shows banners from
 * `onError` / `onNotice` / `onSaving`. GitHub commits stay with the shell (`commitGithub`).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { useDocument } from '../document/useDocument';
import type { FileAccess } from '../platform/files';
import { GitHubError, ensureSignedIn, parseGithubPath, type GithubDocument } from '../platform/github';
import { guardClose } from '../platform/lifecycle';
import { isLocalPath } from '../platform/local';
import { RemoteConflictError, RemoteFileError, isSshPath, remoteHost } from '../platform/remote';
import { pathExists } from '../platform/folders';
import { addRecent, allowRecentDocument, listRecents, removeRecent, type RecentDocument } from '../platform/recents';
import type { DocumentMeta } from '../document/useDocument';

export type UnsavedChoice = 'save' | 'discard' | 'cancel';
export type ConflictChoice = 'overwrite' | 'cancel';

export interface DocumentControllerOptions {
  files: FileAccess;
  /** Asks what to do with a dirty tab that is about to close. */
  confirmUnsaved: (name: string) => Promise<UnsavedChoice>;
  /** Asks what to do when the file changed (or vanished) under a save. */
  confirmConflict: (conflict: { name: string; deleted: boolean }) => Promise<ConflictChoice>;
  /** Save on a GitHub tab; true when committed. Out of this controller's scope (the GitHub controller). */
  commitGithub?: (id: number, gh: GithubDocument, text: string, dirty: boolean, meta: DocumentMeta) => Promise<boolean>;
  onError: (message: string | null) => void;
  onNotice: (message: string | null) => void;
  /** A remote save slower than a second names its host; null when it ends. */
  onSaving: (host: string | null) => void;
}

const messageOf = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useDocumentController(options: DocumentControllerOptions) {
  const session = useDocument();
  const { files } = options;
  // Callbacks are read at call time, so a shell may pass fresh closures every render.
  const opts = useRef(options);
  opts.current = options;
  const failed = useCallback((e: unknown) => opts.current.onError(messageOf(e)), []);
  const [recents, setRecents] = useState<RecentDocument[]>([]);
  useEffect(() => {
    let live = true;
    listRecents().then((list) => live && setRecents(list), () => {});
    return () => {
      live = false;
    };
  }, []);
  const remember = useCallback((path: string | null) => {
    if (path !== null) addRecent(path).then(setRecents, () => {});
  }, []);
  const forget = useCallback((path: string) => removeRecent(path).then(setRecents, () => {}), []);

  /** Writes tab `id`; true when it is on disk, false when cancelled or failed. */
  const doWrite = useCallback(
    async (id: number, as: boolean): Promise<boolean> => {
      const tab = session.peek(id);
      if (tab === null) return true;
      // What is written is what is marked saved, even if typing continues meanwhile.
      const snapshot = tab.text;
      // Save on a GitHub tab commits (after a confirmation); Save As is not offered for GitHub files yet.
      if (!as && tab.meta.github !== undefined) {
        return opts.current.commitGithub ? opts.current.commitGithub(id, tab.meta.github, snapshot, tab.dirty, tab.meta) : false;
      }
      // Save As may not land on a file another tab holds.
      const taken = (path: string) => session.peekTabs().some((t) => t.id !== id && t.path === path);
      const remotePath = !as && tab.meta.path !== null && isSshPath(tab.meta.path) ? tab.meta.path : null;
      const slow = remotePath === null ? null : setTimeout(() => opts.current.onSaving(remoteHost(remotePath)), 1000);
      try {
        const doc = { name: tab.meta.name, path: tab.meta.path, text: snapshot, remote: tab.meta.remote, local: tab.meta.local };
        let saved;
        if (as) saved = await files.saveDocumentAs({ name: tab.meta.name, text: snapshot }, taken);
        else if (tab.meta.path === null) saved = await files.saveDocument({ ...doc, path: null }, taken);
        else {
          try {
            saved = await files.saveDocument(doc);
          } catch (e) {
            if (!(e instanceof RemoteConflictError)) throw e;
            if (slow !== null) clearTimeout(slow);
            opts.current.onSaving(null);
            const choice = await opts.current.confirmConflict({ name: e.name_, deleted: e.deleted });
            // Cancel leaves the tab unsaved, text intact.
            if (choice === 'cancel') return false;
            saved = await files.saveDocument(doc, undefined, { force: true });
          }
        }
        if (saved === null) return false;
        if (saved.path !== null && saved.path !== tab.meta.path && taken(saved.path)) {
          opts.current.onError(`${saved.path} is already open in another tab, so it was not saved there. Choose another name.`);
          return false;
        }
        opts.current.onError(null);
        if (saved.inPlaceHost !== undefined) {
          opts.current.onNotice(`Saved in place on ${remoteHost(saved.inPlaceHost)} (not atomic): the server can't swap files safely, so a dropped connection could leave the file half written.`);
        }
        session.saved(id, { name: saved.name, path: saved.path, remote: saved.remote, local: saved.local }, snapshot);
        if (saved.path !== tab.meta.path) remember(saved.path);
        return true;
      } catch (e) {
        failed(e);
        return false;
      } finally {
        if (slow !== null) clearTimeout(slow);
        opts.current.onSaving(null);
      }
    },
    [files, session.peek, session.peekTabs, session.saved, remember, failed],
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
  const activeId = session.activeId;
  const save = useCallback(() => (activeId === null ? Promise.resolve(true) : write(activeId, false)), [write, activeId]);
  const saveAs = useCallback(() => (activeId === null ? Promise.resolve(true) : write(activeId, true)), [write, activeId]);

  /** Resolves true when it is fine to close tab `id`: clean, saved or discarded. Shows the tab while it asks. */
  const confirmTab = useCallback(
    async (id: number): Promise<boolean> => {
      const tab = session.peek(id);
      if (tab === null || !tab.dirty) return true;
      session.activate(id);
      const choice = await opts.current.confirmUnsaved(tab.meta.name);
      if (choice === 'save') return write(id, false);
      return choice === 'discard';
    },
    [session.peek, session.activate, write],
  );
  const closeTabById = useCallback(
    async (id: number) => {
      if (await confirmTab(id)) session.close(id);
    },
    [confirmTab, session.close],
  );
  const activeIdRef = useRef(activeId);
  activeIdRef.current = activeId;
  const closeTab = useCallback(() => {
    if (activeIdRef.current !== null) void closeTabById(activeIdRef.current);
  }, [closeTabById]);

  const newFile = useCallback(() => {
    opts.current.onError(null);
    session.openUntitled();
  }, [session.openUntitled]);

  const openFile = useCallback(async () => {
    try {
      const opened = await files.pickDocument();
      if (opened === null) return;
      opts.current.onError(null);
      session.open(opened);
      remember(opened.path);
    } catch (e) {
      // A file that cannot be opened leaves whatever is already open untouched.
      failed(e);
    }
  }, [files, session.open, remember, failed]);

  /**
   * Opens a file chosen in the folder navigator or the recent list. `onGithubRecent` runs first for a GitHub
   * recent, so the shell can show its repository and branch.
   */
  const openKnownPath = useCallback(
    async (path: string, fromRecents: boolean, onGithubRecent?: (github: NonNullable<ReturnType<typeof parseGithubPath>>) => void) => {
      if (files.openPath === undefined) return;
      const github = parseGithubPath(path);
      if (github !== null && fromRecents) onGithubRecent?.(github);
      // A file that is already open is shown as it is, unsaved changes and all.
      const existing = session.findByPath(path);
      if (existing !== null) return session.activate(existing);
      try {
        // A local:// recent needs no scope entry: openPath checks its grant and root itself and removes the recent when they fail.
        if (fromRecents && github === null && !isLocalPath(path)) {
          await allowRecentDocument(path);
          // A remote file stays in the list when its host is unreachable; opening it reports why.
          if (!isSshPath(path) && !(await pathExists(path))) {
            await forget(path);
            return opts.current.onError(`${path} no longer exists, so it was removed from recent documents.`);
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
        opts.current.onError(null);
        session.open(opened);
        remember(opened.path);
      } catch (e) {
        // Only a file the server says is gone leaves the recent list.
        if (fromRecents && e instanceof RemoteFileError && e.kind === 'not_found') await forget(path);
        failed(e);
      }
    },
    [files, session.findByPath, session.activate, session.open, remember, forget, failed],
  );

  // Closing the window with unsaved changes asks first.
  // Every unsaved tab is asked about in turn; Cancel on any of them keeps the window open.
  const confirmWindowClose = useCallback(async () => {
    for (const id of session.dirtyIds()) if (!(await confirmTab(id))) return false;
    return true;
  }, [session.dirtyIds, confirmTab]);
  const guard = useRef({ anyDirty: session.dirtyIds, confirmWindowClose });
  guard.current = { anyDirty: session.dirtyIds, confirmWindowClose };
  useEffect(() => guardClose(() => guard.current.anyDirty().length > 0, () => guard.current.confirmWindowClose()), []);

  return {
    session,
    hasDocument: session.meta !== null,
    save,
    saveAs,
    newFile,
    openFile,
    /** Closes the active tab (asking about unsaved changes); does nothing without one. */
    closeTab,
    closeTabById,
    openKnownPath,
    recents,
    remember,
    forgetRecent: forget,
  };
}
