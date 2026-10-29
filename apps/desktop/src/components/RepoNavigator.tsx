/**
 * The GitHub repository navigator, shown by FolderSidebar when a repo is open: a header (owner/repo, the
 * branch dropdown and the create-branch icon) above a lazily listed folder tree
 * (platform/folders.ts listFolderPage on github:// paths). Switching branch reloads the tree and keeps only
 * the expanded folders that exist on the new branch. The Refresh button (and View > Refresh Navigator, via `refreshSignal`) re-lists the root and the expanded folders (and the branch list) in place, shows a busy state meanwhile, keeps the rows on screen when a re-list fails, and switches to the default branch when the open branch was deleted. Exports RepoNavigator, RepoState, BRANCH_RENDER_CAP and describeError.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, File, Folder, GitBranch, GitBranchPlus, Loader2, RefreshCw } from 'lucide-react';
import { ListDirectoryError, listFolderPage, type FolderEntry } from '../platform/folders';
import { ensureSignedIn, githubPath, listBranches, parseGithubPath, toGitHubError } from '../platform/github';

/** The repository and branch the navigator shows; App.tsx owns it. */
export interface RepoState {
  owner: string;
  repo: string;
  branch: string;
}

/** Rows rendered per folder before "Show more" (FolderSidebar's ROW_CHUNK; not imported, to keep imports acyclic). */
const ROW_CHUNK = 200;

/** The dropdown renders at most this many matching branches; the rest need a narrower filter. */
export const BRANCH_RENDER_CAP = 100;

const isBranchGone = (e: unknown) => e instanceof ListDirectoryError && e.kind === 'branch_not_found';

const muted = 'm-0 py-1 text-[12.5px] text-muted-foreground';
const link = 'cursor-pointer border-0 bg-transparent p-0 text-[12.5px] underline';

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

function errorParts(e: unknown, what: string) {
  if (e instanceof ListDirectoryError) return { kind: e.kind as string, ...describeError(e.kind, e.message, e.resetAt, what) };
  const g = toGitHubError(e);
  return { kind: g.kind as string, ...describeError(g.kind, g.message, g.resetAt, what) };
}

function ErrorLine({ e, what, pad, onRetry }: { e: unknown; what: string; pad: number; onRetry: () => void }) {
  const { text, action } = errorParts(e, what);
  const signIn = () => void ensureSignedIn().then((ok) => ok && onRetry(), () => {});
  return (
    <p role="alert" style={{ paddingLeft: pad }} className="m-0 py-1 text-[12.5px] text-destructive">
      {text}
      {action !== null && (
        <>
          {' '}
          <button type="button" onClick={action === 'retry' ? onRetry : signIn} className={`${link} text-destructive`}>
            {action === 'retry' ? 'Retry' : 'Sign in'}
          </button>
        </>
      )}
    </p>
  );
}

function BranchMenu({
  owner,
  repo,
  branch,
  extra,
  refreshKey,
  onSelect,
}: {
  owner: string;
  repo: string;
  branch: string;
  /** Branches made in this session, listed even when GitHub's pages (loaded earlier) do not include them. */
  extra: string[];
  /** Bumped by the Refresh button: the branch list is fetched again from page 1. */
  refreshKey: number;
  onSelect: (branch: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState('');
  const [branches, setBranches] = useState<string[]>([]);
  const [loadingMore, setLoadingMore] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);
  const loaded = useRef<{ next: number | null; names: string[] }>({ next: 1, names: [] });
  const root = useRef<HTMLDivElement>(null);
  const seenRefresh = useRef(refreshKey);

  // Pages load one after another, in the background, so the list is complete without opening the menu.
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

  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => root.current !== null && !root.current.contains(ev.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const all = useMemo(() => [...branches, ...extra.filter((b) => !branches.includes(b))], [branches, extra]);
  const matches = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q === '' ? all : all.filter((b) => b.toLowerCase().includes(q));
  }, [all, filter]);
  const shown = matches.slice(0, BRANCH_RENDER_CAP);

  const choose = (b: string) => {
    setOpen(false);
    setFilter('');
    if (b !== branch) onSelect(b);
  };

  return (
    <div ref={root} className="relative min-w-0" onKeyDown={(ev) => ev.key === 'Escape' && open && (ev.stopPropagation(), setOpen(false))}>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`Branch: ${branch}`}
        title={branch}
        onClick={() => setOpen((o) => !o)}
        className="flex w-full min-w-0 cursor-pointer items-center gap-1.5 rounded-control border border-solid border-border bg-transparent px-2 py-1 text-left text-[12.5px] text-foreground hover:bg-surface"
      >
        <GitBranch size={12} aria-hidden className="shrink-0" />
        <span className="min-w-0 flex-1 truncate">{branch}</span>
        <ChevronDown size={12} aria-hidden className="shrink-0" />
      </button>
      {open && (
        <div className="absolute left-0 right-0 z-20 mt-1 rounded-control border border-solid border-border bg-background p-1 shadow-md">
          <input
            autoFocus
            type="text"
            aria-label="Filter branches"
            placeholder="Filter branches"
            value={filter}
            onChange={(ev) => setFilter(ev.target.value)}
            className="mb-1 box-border w-full rounded-control border border-solid border-border bg-transparent px-2 py-1 text-[12.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <ul role="listbox" aria-label="Branches" className="m-0 max-h-[240px] list-none overflow-y-auto p-0">
            {shown.map((b) => (
              <li key={b} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={b === branch}
                  title={b}
                  onClick={() => choose(b)}
                  className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent px-1 py-1 text-left text-[12.5px] text-foreground hover:bg-surface"
                >
                  <Check size={11} aria-hidden className="shrink-0" style={{ visibility: b === branch ? 'visible' : 'hidden' }} />
                  <span className="min-w-0 break-all">{b}</span>
                </button>
              </li>
            ))}
          </ul>
          {matches.length > shown.length && (
            <p className={`${muted} px-1`}>
              Showing the first {shown.length} of {matches.length} branches. Type to narrow the list.
            </p>
          )}
          {matches.length === 0 && !loadingMore && error === null && <p className={`${muted} px-1`}>{all.length === 0 ? 'No branches.' : 'No branch matches.'}</p>}
          {loadingMore && (
            <p role="status" className={`${muted} flex items-center gap-1.5 px-1`}>
              <Loader2 size={12} aria-hidden className="animate-spin" />
              Loading more…
            </p>
          )}
          {error !== null && <ErrorLine e={error} what="loading branches" pad={4} onRetry={() => setAttempt((n) => n + 1)} />}
        </div>
      )}
    </div>
  );
}

type Listing = { state: 'loading' } | { state: 'ok'; entries: FolderEntry[]; truncated: boolean } | { state: 'error'; error: unknown };

/** Whether a failure means the folder is gone from this branch (so it is no longer expanded). */
const folderGone = (e: unknown) => e instanceof ListDirectoryError && (e.kind === 'path_not_found' || e.kind === 'not_a_folder');

/** The github:// path of the repository's root folder on the current branch. */
function rootPath(repo: RepoState): string {
  return githubPath({ ...repo, path: '' });
}

export function RepoNavigator({
  repo,
  currentPath,
  createdBranches = [],
  onBranchChange,
  onCreateBranch,
  onOpenFile,
  refreshSignal = 0,
}: {
  repo: RepoState;
  currentPath: string | null;
  /** Branches created in this session on this repository (App's session list). */
  createdBranches?: string[];
  onBranchChange: (branch: string) => void;
  onCreateBranch?: () => void;
  onOpenFile: (path: string) => void;
  /** Bumped by App (View > Refresh Navigator) to refresh like the button does. */
  refreshSignal?: number;
}) {
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
        // The open branch was deleted: move to the default branch (App warns about unsaved changes first).
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

  const renderLevel = (path: string, depth: number) => {
    const l = listings.get(path);
    const pad = depth * 14;
    if (l === undefined || l.state === 'loading') {
      return (
        <p role="status" style={{ paddingLeft: pad }} className={muted}>
          Loading…
        </p>
      );
    }
    if (l.state === 'error') return <ErrorLine e={l.error} what="listing this folder" pad={pad} onRetry={() => retry(path)} />;
    if (l.entries.length === 0 && !l.truncated)
      return (
        <p style={{ paddingLeft: pad }} className={muted}>
          {depth === 0 ? 'No Markdown files in this branch.' : 'No Markdown files in this folder.'}
        </p>
      );
    const count = shown.get(path) ?? ROW_CHUNK;
    const remaining = l.entries.length - count;
    return (
      <>
        <ul className="m-0 list-none p-0">
          {l.entries.slice(0, count).map((entry) => (
            <li key={entry.path}>
              {entry.isDir ? (
                <>
                  <button
                    type="button"
                    aria-expanded={expanded.has(entry.path)}
                    onClick={() => toggle(entry.path)}
                    title={entry.name}
                    style={{ paddingLeft: pad }}
                    className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent py-1 text-left text-[13px] text-foreground hover:bg-surface"
                  >
                    <Folder size={12} aria-hidden className="shrink-0 fill-current" />
                    <span className="truncate">{entry.name}</span>
                  </button>
                  {expanded.has(entry.path) && renderLevel(entry.path, depth + 1)}
                </>
              ) : (
                <button
                  type="button"
                  aria-current={entry.path === currentPath ? 'true' : undefined}
                  onClick={() => onOpenFile(entry.path)}
                  title={entry.name}
                  style={{ paddingLeft: pad }}
                  className={`flex w-full cursor-pointer items-center gap-1.5 border-0 py-1 text-left text-[13px] text-foreground hover:bg-surface ${
                    entry.path === currentPath ? 'bg-surface font-semibold' : 'bg-transparent'
                  }`}
                >
                  <File size={12} aria-hidden className="shrink-0" />
                  <span className="truncate">{entry.name}</span>
                </button>
              )}
            </li>
          ))}
          {remaining > 0 && (
            <li>
              <button
                type="button"
                onClick={() => setShown((prev) => new Map(prev).set(path, count + ROW_CHUNK))}
                style={{ paddingLeft: pad }}
                className="w-full cursor-pointer border-0 bg-transparent py-1 text-left text-[12.5px] text-muted-foreground hover:bg-surface"
              >
                Show more ({remaining} more)
              </button>
            </li>
          )}
        </ul>
        {l.truncated && (
          <p role="note" style={{ paddingLeft: pad }} className={muted}>
            Showing what GitHub returned; the folder may have more.
          </p>
        )}
      </>
    );
  };

  const rootListing = listings.get(root);
  const rootError = rootListing?.state === 'error' ? rootListing.error : null;
  const branchGone = isBranchGone(rootError);

  return (
    <div>
      <div className="mb-2 min-w-0">
        <div title={`${repo.owner}/${repo.repo}`} className="mb-1 truncate text-[12.5px] font-semibold text-foreground">
          {repo.owner}/{repo.repo}
        </div>
        <div className="flex min-w-0 items-center gap-1">
          <div className="min-w-0 flex-1">
            <BranchMenu key={`${repo.owner}/${repo.repo}`} owner={repo.owner} repo={repo.repo} branch={repo.branch} extra={createdBranches} refreshKey={refreshKey} onSelect={onBranchChange} />
          </div>
          <span data-slot="branch-actions" className="flex shrink-0 items-center">
            <button
              type="button"
              aria-label="Refresh"
              title="Refresh"
              aria-busy={busy}
              disabled={busy}
              onClick={refresh}
              className="flex h-6 w-6 cursor-pointer disabled:cursor-default disabled:opacity-60 items-center justify-center rounded-control border-0 bg-transparent text-foreground hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
            >
              <RefreshCw size={14} aria-hidden className={busy ? 'animate-spin' : undefined} />
            </button>
            <button
              type="button"
              aria-label="Create branch"
              title="Create branch"
              onClick={() => onCreateBranch?.()}
              className="flex h-6 w-6 cursor-pointer items-center justify-center rounded-control border-0 bg-transparent text-foreground hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
            >
              <GitBranchPlus size={14} aria-hidden />
            </button>
          </span>
        </div>
      </div>
      {refreshError !== null && !branchGone && <ErrorLine e={refreshError} what="refreshing the navigator" pad={0} onRetry={refresh} />}
      {branchGone ? (
        <p role="alert" className="m-0 py-1 text-[12.5px] text-destructive">
          The branch “{repo.branch}” no longer exists on GitHub. Choose another branch.
        </p>
      ) : (
        renderLevel(root, 0)
      )}
    </div>
  );
}
