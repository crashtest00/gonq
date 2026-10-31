/**
 * The folder navigator's listing logic, shared by the desktop FolderSidebar and the mobile folder sheet: useFolderListing
 * (one folder's rows, listed lazily; a refresh re-lists in place and keeps the rows when it fails, "Show more" chunks of
 * ROW_CHUNK, a retry counter) and useNavigatorRefresh (the Refresh button's busy state: one refresh at a time, also driven
 * by a signal such as View > Refresh Navigator). Renders nothing: each shell draws the rows, so expansion state stays in the
 * nodes the shell mounts and survives a refresh.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { ListDirectoryError, listDirectory, type FolderEntry } from '../platform/folders';

/** Rows rendered per chunk; larger folders reveal the rest on request so they stay responsive. */
export const ROW_CHUNK = 200;

/** Tree listings report their refresh re-lists here so the Refresh button can show a busy state. */
export interface RefreshTracker {
  start: () => void;
  end: () => void;
}

/** The message of a failed listing. */
export const listingMessage = (e: unknown): string => (e instanceof ListDirectoryError || e instanceof Error ? e.message : String(e));

/** The Refresh button's state: `refresh()` bumps `refreshKey` unless a re-list is still running; `tracker` is for the listings. */
export function useNavigatorRefresh(refreshSignal = 0) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState(0);
  const pendingRef = useRef(0);
  const tracker = useRef<RefreshTracker>({
    start: () => {
      pendingRef.current += 1;
      setPending(pendingRef.current);
    },
    end: () => {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      setPending(pendingRef.current);
    },
  }).current;
  // One refresh at a time: a click or command while the last is still listing does nothing.
  const refresh = useCallback(() => {
    if (pendingRef.current > 0) return;
    setRefreshKey((n) => n + 1);
  }, []);
  const seenSignal = useRef(refreshSignal);
  useEffect(() => {
    if (seenSignal.current === refreshSignal) return;
    seenSignal.current = refreshSignal;
    refresh();
  }, [refreshSignal, refresh]);
  return { refreshKey, refresh, busy: pending > 0, tracker };
}

/**
 * The rows of folder `path`. `entries` is null while the first listing runs; `error` replaces the rows when it fails (with its
 * `errorKind`). A change of `refreshKey` re-lists in place, reporting to `tracker`; a failed refresh sets `refreshError` and keeps the rows.
 */
export function useFolderListing(path: string, refreshKey: number, tracker: RefreshTracker | null) {
  const [entries, setEntries] = useState<FolderEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [shown, setShown] = useState(ROW_CHUNK);
  const [attempt, setAttempt] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);

  // A refresh re-lists in place: the current rows stay until the new ones arrive.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;
  const listedFor = useRef({ path, attempt, refreshKey });
  useEffect(() => {
    let live = true;
    const was = listedFor.current;
    listedFor.current = { path, attempt, refreshKey };
    const reload = was.path !== path || was.attempt !== attempt;
    if (reload) {
      setEntries(null);
      setShown(ROW_CHUNK);
    }
    // A refresh (same path, new key) reports to the Refresh button's busy state.
    const refreshing = !reload && was.refreshKey !== refreshKey;
    if (refreshing) tracker?.start();
    setErrorKind(null);
    setError(null);
    setRefreshError(null);
    listDirectory(path).then(
      (rows) => {
        if (refreshing) tracker?.end();
        if (live) setEntries(rows);
      },
      (e) => {
        if (refreshing) tracker?.end();
        if (!live) return;
        const message = listingMessage(e);
        // A failed refresh keeps the rows that are already shown.
        if (refreshing && entriesRef.current !== null) return setRefreshError(message);
        setEntries(null);
        setErrorKind(e instanceof ListDirectoryError ? e.kind : null);
        setError(message);
      },
    );
    return () => {
      live = false;
    };
  }, [path, attempt, refreshKey]);

  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  const showMore = useCallback(() => setShown((n) => n + ROW_CHUNK), []);
  return { entries, error, errorKind, refreshError, shown, showMore, retry };
}
