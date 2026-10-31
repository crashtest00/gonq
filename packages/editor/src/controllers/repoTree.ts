/**
 * The GitHub repository navigator's logic, shared by the desktop RepoNavigator and the mobile repo screen: useRepoTree
 * (lazy folder listings, expanded folders, "Show more" counts, and Refresh that re-lists the root and the expanded
 * folders in place, keeps the rows when a re-list fails and falls back to the default branch when the open branch was
 * deleted), useBranchList (the paged branch list plus this session's branches), filterBranches, describeError (the
 * wording of every listing error) and errorParts. Renders nothing: each shell draws the rows.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ListDirectoryError, listFolderPage, type FolderEntry } from '../platform/folders';
import { githubPath, listBranches, parseGithubPath, toGitHubError } from '../platform/github';

/** The repository and branch the navigator shows. */
export interface RepoState {
  owner: string;
  repo: string;
  branch: string;
}

/** Rows rendered per folder before "Show more". */
export const ROW_CHUNK = 200;

/** The branch list renders at most this many matching branches; the rest need a narrower filter. */
export const BRANCH_RENDER_CAP = 100;

export const isBranchGone = (e: unknown) => e instanceof ListDirectoryError && e.kind === 'branch_not_found';

/** Whether a failure means the folder is gone from this branch (so it is no longer expanded). */
const folderGone = (e: unknown) => e instanceof ListDirectoryError && (e.kind === 'path_not_found' || e.kind === 'not_a_folder');

/** Words for a failed listing or branch load, and which action (if any) can fix it. */
export function describeError(kind: string, message: string, resetAt: number | null, what: string): { text: string; action: 'retry' | 'sign-in' | null } {
  switch (kind) {
    case 'empty_repo':
      return { text: 'This repository is empty: it has no commits yet.', action: null };
    case 'branch_not_found':
      return { text: `The branch no longer exists on GitHub. Choose another branch.`, action: null };
    case 'path_not_found':
    case 'not_a_folder':
      return { text: 'This folder no longer exists on this branch.', action: 'retry' };
    case 'not_signed_in':
      return { text: 'Sign in to GitHub to browse this repository.', action: 'sign-in' };
    case 'rate_limited': {
      const when = resetAt === null ? 'Try again later.' : `Try again after ${new Date(resetAt * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`;
      return { text: `GitHub rate limit reached. ${when}`, action: 'retry' };
    }
    case 'network':
      return { text: `Could not reach GitHub while ${what}. ${message}`, action: 'retry' };
    default:
      return { text: message, action: 'retry' };
  }
}

/** describeError for any thrown value (a ListDirectoryError or whatever toGitHubError makes of it). */
export function errorParts(e: unknown, what: string) {
  if (e instanceof ListDirectoryError) return { kind: e.kind as string, ...describeError(e.kind, e.message, e.resetAt, what) };
  const g = toGitHubError(e);
  return { kind: g.kind as string, ...describeError(g.kind, g.message, g.resetAt, what) };
}

/** The branches matching `filter` (case-insensitive), and the first BRANCH_RENDER_CAP of them. */
export function filterBranches(all: string[], filter: string): { matches: string[]; shown: string[] } {
  const q = filter.trim().toLowerCase();
  const matches = q === '' ? all : all.filter((b) => b.toLowerCase().includes(q));
  return { matches, shown: matches.slice(0, BRANCH_RENDER_CAP) };
}

/**
 * The repository's branches, loaded page after page in the background (so the list is complete without opening the
 * menu), with `extra` (branches made this session) merged in. `refreshKey` changing fetches again from page 1.
 */
export function useBranchList(owner: string, repo: string, extra: string[], refreshKey: number) {
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingMore, setLoadingMore] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef<{ next: number | null; names: string[] }>({ next: 1, names: [] });
  const seenRefresh = useRef(refreshKey);

  useEffect(() => {
    let live = true;
    const refreshed = seenRefresh.current !== refreshKey;
    seenRefresh.current = refreshKey;
    if (attempt === 0 || refreshed) loaded.current = { next: 1, names: [] };
    setError(null);
    setLoadingMore(true);
    (async () => {
      while (live && loaded.current.next !== null) {
        const page = await listBranches(owner, repo, loaded.current.next);
        if (!live) return;
        const seen = new Set(loaded.current.names);
        loaded.current = {
          next: page.nextPage,
          names: [...loaded.current.names, ...page.branches.filter((b) => !seen.has(b))],
        };
        setBranches(loaded.current.names);
      }
      if (live) setLoadingMore(false);
    })().catch((e) => {
      if (!live) return;
      setError(e);
      setLoadingMore(false);
    });
    return () => {
      live = false;
    };
  }, [owner, repo, attempt, refreshKey]);

  const all = useMemo(() => [...branches, ...extra.filter((b) => !branches.includes(b))], [branches, extra]);
  const retry = useCallback(() => setAttempt((n) => n + 1), []);
  return { all, loadingMore, error, retry };
}

export type Listing = { state: 'loading' } | { state: 'ok'; entries: FolderEntry[]; truncated: boolean } | { state: 'error'; error: unknown };

/** The github:// path of the repository's root folder on the current branch. */
export const rootPath = (repo: RepoState): string => githubPath({ ...repo, path: '' });

/**
 * The folder tree of `repo`. Switching branch reloads it and keeps only the expanded folders that exist on the new
 * branch. `refresh()` (or `refreshSignal` changing) re-lists in place; `onBranchChange` is called only with the
 * default branch, when a refresh finds the open branch deleted.
 */
export function useRepoTree(repo: RepoState, onBranchChange: (branch: string) => void, refreshSignal = 0) {
  const root = rootPath(repo);
  const [listings, setListings] = useState<Map<string, Listing>>(new Map());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState<Map<string, number>>(new Map());
  // Each (re)load of the tree gets a number; answers from an older one are dropped.
  const generation = useRef(0);
  const expandedRef = useRef(expanded);
  expandedRef.current = expanded;
  const listingsRef = useRef(listings);
  listingsRef.current = listings;
  const [refreshKey, setRefreshKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [refreshError, setRefreshError] = useState<unknown>(null);
  const loadedRoot = useRef(root);
  const onBranchChangeRef = useRef(onBranchChange);
  onBranchChangeRef.current = onBranchChange;
  const branchRef = useRef(repo.branch);
  branchRef.current = repo.branch;

  const refresh = useCallback(() => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setRefreshKey((n) => n + 1);
  }, []);
  const seenSignal = useRef(refreshSignal);
  useEffect(() => {
    if (seenSignal.current === refreshSignal) return;
    seenSignal.current = refreshSignal;
    refresh();
  }, [refreshSignal, refresh]);

  const put = useCallback((gen: number, path: string, l: Listing) => {
    if (gen !== generation.current) return;
    setListings((prev) => new Map(prev).set(path, l));
  }, []);

  const load = useCallback(
    async (path: string, quiet = false): Promise<Exclude<Listing, { state: 'loading' }>> => {
      const gen = generation.current;
      if (!quiet) put(gen, path, { state: 'loading' });
      let result: Exclude<Listing, { state: 'loading' }>;
      try {
        const page = await listFolderPage(path);
        result = { state: 'ok', entries: page.entries, truncated: page.truncated };
      } catch (e) {
        result = { state: 'error', error: e };
      }
      // A refresh that fails leaves the rows already shown in place (the error is reported separately).
      if (quiet && result.state === 'error' && listingsRef.current.get(path)?.state === 'ok' && !folderGone(result.error) && !isBranchGone(result.error)) return result;
      put(gen, path, result);
      return result;
    },
    [put],
  );

  // A new branch (or repository): list the root, then every folder that was expanded and still exists.
  useEffect(() => {
    const gen = ++generation.current;
    // Expanded folders are remembered by their path in the repository; the branch is part of a github:// path.
    const at = parseGithubPath(root)!;
    const keep = new Set([...expandedRef.current].map((p) => githubPath({ ...at, path: parseGithubPath(p)?.path ?? '' })));
    // A refresh keeps the rows on screen and swaps in the new listings; a new branch starts empty.
    const quiet = loadedRoot.current === root;
    loadedRoot.current = root;
    if (!quiet) {
      busyRef.current = false;
      setBusy(false);
      setRefreshError(null);
      setListings(new Map());
      setShown(new Map());
    }
    const finishRefresh = (error: unknown) => {
      if (!busyRef.current) return;
      busyRef.current = false;
      setBusy(false);
      setRefreshError(error);
    };
    (async () => {
      const survivors = new Set<string>();
      let failedFolder: unknown = null;
      const rootListing = await load(root, quiet);
      if (gen !== generation.current) return;
      if (rootListing.state === 'error') {
        // The open branch was deleted: move to the default branch (the shell warns about unsaved changes first).
        if (quiet && isBranchGone(rootListing.error)) {
          try {
            const fallback = (await listBranches(at.owner, at.repo, 1)).defaultBranch;
            if (gen !== generation.current) return;
            if (fallback !== branchRef.current) onBranchChangeRef.current(fallback);
          } catch {
            /* the "branch no longer exists" message stays */
          }
        } else if (quiet) {
          // Root could not be re-listed: keep the tree as it was, expanded folders included.
          setExpanded(keep);
        }
        finishRefresh(quiet && !isBranchGone(rootListing.error) ? rootListing.error : null);
        return;
      }
      const known = new Set<string>();
      if (rootListing.state === 'ok') for (const e of rootListing.entries) if (e.isDir) known.add(e.path);
      // Parents first: a folder is only tried when its parent was listed here and contains it.
      const pending = [...keep].filter((p) => p !== root).sort((a, b) => a.length - b.length);
      for (const path of pending) {
        if (!known.has(path)) continue;
        const l = await load(path, quiet);
        if (gen !== generation.current) return;
        if (l.state === 'ok') {
          survivors.add(path);
          for (const e of l.entries) if (e.isDir) known.add(e.path);
        } else if (!folderGone(l.error)) {
          survivors.add(path);
          if (quiet) failedFolder = l.error;
        }
      }
      setExpanded(survivors);
      finishRefresh(failedFolder);
    })().catch(() => finishRefresh(null));
  }, [root, load, refreshKey]);

  const toggle = useCallback(
    (path: string) => {
      const open = expandedRef.current.has(path);
      setExpanded((prev) => {
        const next = new Set(prev);
        if (open) next.delete(path);
        else next.add(path);
        return next;
      });
      if (!open && listingsRef.current.get(path) === undefined) void load(path);
    },
    [load],
  );

  const retry = useCallback((path: string) => void load(path), [load]);
  const showMore = useCallback((path: string) => setShown((prev) => new Map(prev).set(path, (prev.get(path) ?? ROW_CHUNK) + ROW_CHUNK)), []);

  const rootListing = listings.get(root);
  const rootError = rootListing?.state === 'error' ? rootListing.error : null;
  return { root, listings, expanded, shown, toggle, retry, showMore, refresh, refreshKey, busy, refreshError, branchGone: isBranchGone(rootError) };
}
