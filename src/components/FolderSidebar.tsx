/**
 * The folder navigator sidebar: Project folder tree (local or ssh://, listed lazily in chunks; or the GitHub
 * repo navigator when `repo` is set; both have a Refresh button, also View > Refresh Navigator via `refreshSignal`, that re-lists the tree in place keeping expanded folders and scroll, shows a busy state and keeps the rows when the re-list fails) and Recent documents. Exports basename, relativeTime and the row-chunk/spinner constants.
 */
import { createContext, memo, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { ChevronRight, File, Folder, Loader2, RefreshCw, X } from 'lucide-react';
import { ListDirectoryError, listDirectory, type FolderEntry } from '../platform/folders';
import type { RecentDocument } from '../platform/recents';
import { RepoNavigator, type RepoState } from './RepoNavigator';
import { parseGithubPath } from '../platform/github';
import { isSshPath, remoteAccount, remoteFileName } from '../platform/remote';

export function basename(path: string): string {
  const gh = parseGithubPath(path);
  if (gh !== null) return gh.path.split('/').pop() || `${gh.owner}/${gh.repo}`;
  return path.split(/[\\/]/).filter(Boolean).pop() ?? path;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", else the date. */
export function relativeTime(then: number, now: number = Date.now()): string {
  const s = Math.max(0, Math.round((now - then) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)} d ago`;
  return new Date(then).toLocaleDateString();
}

/** The last segment of a remote folder; "/" for the root. */
function remoteFolderName(uri: string): string {
  const name = remoteFileName(uri);
  return name === uri ? '/' : name;
}

function SectionHeader({ label, open, onToggle }: { label: string; open: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      aria-expanded={open}
      onClick={onToggle}
      className="mb-1 flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-left text-[12px] font-semibold uppercase tracking-[0.06em] text-muted-foreground"
    >
      <ChevronRight size={9} aria-hidden className="shrink-0 transition-transform duration-[120ms]" style={{ transform: open ? 'rotate(90deg)' : 'none' }} />
      {label}
    </button>
  );
}

/** Rows rendered per chunk; larger folders reveal the rest on request so they stay responsive. */
export const ROW_CHUNK = 200;

/** A remote folder shows its spinner only after this long. */
export const SPINNER_DELAY_MS = 150;

/** Tree listings report their refresh re-lists here so the Refresh button can show a busy state. */
const RefreshTracker = createContext<{ start: () => void; end: () => void } | null>(null);

const Row = memo(function Row({
  entry,
  depth,
  expanded,
  currentPath,
  refreshKey,
  onToggle,
  onOpenFile,
  onLogin,
}: {
  entry: FolderEntry;
  depth: number;
  expanded: boolean;
  currentPath: string | null;
  refreshKey: number;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onLogin?: (path: string) => Promise<boolean> | void;
}) {
  const pad = { paddingLeft: depth * 14 };
  const current = entry.path === currentPath;
  return (
    <li>
      {entry.isDir ? (
        <>
          <button
            type="button"
            aria-expanded={expanded}
            onClick={() => onToggle(entry.path)}
            title={entry.path}
            style={pad}
            className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent py-1 text-left text-[13px] text-foreground hover:bg-surface"
          >
            <Folder size={12} aria-hidden className="shrink-0 fill-current" />
            <span className="truncate">{entry.name}</span>
          </button>
          {expanded && <Tree path={entry.path} depth={depth + 1} currentPath={currentPath} refreshKey={refreshKey} onOpenFile={onOpenFile} onLogin={onLogin} />}
        </>
      ) : (
        <button
          type="button"
          aria-current={current ? 'true' : undefined}
          onClick={() => onOpenFile(entry.path)}
          title={entry.path}
          style={pad}
          className={`flex w-full cursor-pointer items-center gap-1.5 border-0 py-1 text-left text-[13px] text-foreground hover:bg-surface ${
            current ? 'bg-surface font-semibold' : 'bg-transparent'
          }`}
        >
          <File size={12} aria-hidden className="shrink-0" />
          <span className="truncate">{entry.name}</span>
        </button>
      )}
    </li>
  );
});

function Tree({ path, depth, currentPath, refreshKey, onOpenFile, onLogin }: { path: string; depth: number; currentPath: string | null; refreshKey: number; onOpenFile: (path: string) => void; onLogin?: (path: string) => Promise<boolean> | void }) {
  const [entries, setEntries] = useState<FolderEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(ROW_CHUNK);
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [refreshError, setRefreshError] = useState<string | null>(null);
  const tracker = useContext(RefreshTracker);
  // A remote listing shows its spinner only once it has taken longer than 150 ms.
  const [slow, setSlow] = useState(false);

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
        const message = e instanceof ListDirectoryError || e instanceof Error ? e.message : String(e);
        // A failed refresh keeps the rows that are already shown.
        if (refreshing && entriesRef.current !== null) return setRefreshError(message);
        setEntries(null);
        setErrorKind(e instanceof ListDirectoryError ? e.kind : null);
        setError(e instanceof ListDirectoryError || e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [path, attempt, refreshKey]);

  useEffect(() => {
    setSlow(false);
    if (entries !== null || error !== null || !isSshPath(path)) return;
    const timer = setTimeout(() => setSlow(true), SPINNER_DELAY_MS);
    return () => clearTimeout(timer);
  }, [path, attempt, entries, error]);

  const toggle = useCallback((p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(p)) next.add(p);
      return next;
    });
  }, []);

  const pad = { paddingLeft: depth * 14 };
  if (error !== null)
    return (
      <p role="alert" style={pad} className="m-0 py-1 text-[12.5px] text-destructive">
        {error}
        {errorKind === 'disconnected' && (
          <>
            {' '}
            <button type="button" onClick={() => setAttempt((n) => n + 1)} className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-destructive underline">
              Retry
            </button>
          </>
        )}
        {errorKind === 'auth_required' && onLogin && (
          <>
            {' '}
            <button type="button" onClick={() => void Promise.resolve(onLogin(path)).then((ok) => ok === true && setAttempt((n) => n + 1))} className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-destructive underline">
              Log in
            </button>
          </>
        )}
      </p>
    );
  if (entries === null) {
    if (isSshPath(path)) {
      return slow ? (
        <p role="status" style={pad} className="m-0 flex items-center gap-1.5 py-1 text-[12.5px] text-muted-foreground">
          <Loader2 size={12} aria-hidden className="animate-spin" />
          Loading…
        </p>
      ) : null;
    }
    return <p style={pad} className="m-0 py-1 text-[12.5px] text-muted-foreground">Loading…</p>;
  }
  if (entries.length === 0) return <p style={pad} className="m-0 py-1 text-[12.5px] text-muted-foreground">{depth === 0 ? 'No Markdown files.' : 'Empty.'}</p>;

  const remaining = entries.length - shown;
  return (
    <>
    {refreshError !== null && (
      <p role="alert" style={pad} className="m-0 py-1 text-[12.5px] text-destructive">
        Could not refresh: {refreshError}
      </p>
    )}
    <ul className="m-0 list-none p-0">
      {entries.slice(0, shown).map((entry) => (
        <Row
          key={entry.path}
          entry={entry}
          depth={depth}
          expanded={expanded.has(entry.path)}
          currentPath={currentPath}
          refreshKey={refreshKey}
          onToggle={toggle}
          onOpenFile={onOpenFile}
          onLogin={onLogin}
        />
      ))}
      {remaining > 0 && (
        <li>
          <button
            type="button"
            onClick={() => setShown((n) => n + ROW_CHUNK)}
            style={pad}
            className="w-full cursor-pointer border-0 bg-transparent py-1 text-left text-[12.5px] text-muted-foreground hover:bg-surface"
          >
            Show more ({remaining} more)
          </button>
        </li>
      )}
    </ul>
    </>
  );
}

export function FolderSidebar({
  folder,
  repo = null,
  createdBranches,
  onBranchChange,
  onCreateBranch,
  recents,
  currentPath,
  onOpenFolder,
  onOpenFile,
  onLogin,
  onOpenRecent,
  onRemoveRecent,
  refreshSignal = 0,
}: {
  folder: string | null;
  /** Bumped by App (View > Refresh Navigator) to refresh like the button does. */
  refreshSignal?: number;
  /** An open GitHub repository; it takes the Project folder section from `folder`. */
  repo?: RepoState | null;
  /** Branches created in this session on the open repository. */
  createdBranches?: string[];
  onBranchChange?: (branch: string) => void;
  onCreateBranch?: () => void;
  recents: RecentDocument[];
  currentPath: string | null;
  onOpenFolder: () => void;
  onOpenFile: (path: string) => void;
  /** Reopens the Connect dialog for a remote folder whose login ran out; no Log in button without it. */
  onLogin?: (path: string) => Promise<boolean> | void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
}) {
  const [projectOpen, setProjectOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [pending, setPending] = useState(0);
  const pendingRef = useRef(0);
  const tracker = useRef({
    start: () => {
      pendingRef.current += 1;
      setPending(pendingRef.current);
    },
    end: () => {
      pendingRef.current = Math.max(0, pendingRef.current - 1);
      setPending(pendingRef.current);
    },
  }).current;
  const busy = pending > 0;
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

  return (
    <aside aria-label="Folder navigator" className="flex w-full shrink-0 overflow-hidden">
      <nav className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
        <section className="mb-4">
          <SectionHeader label="Project folder" open={projectOpen} onToggle={() => setProjectOpen((o) => !o)} />
          {projectOpen &&
            (repo !== null ? (
              <RepoNavigator repo={repo} refreshSignal={refreshSignal} currentPath={currentPath} createdBranches={createdBranches} onBranchChange={onBranchChange ?? (() => {})} onCreateBranch={onCreateBranch} onOpenFile={onOpenFile} />
            ) : folder !== null ? (
              <>
                <div className="mb-1 flex min-w-0 items-center gap-1">
                  <div title={folder} className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-foreground">{isSshPath(folder) ? remoteFolderName(folder) : basename(folder)}</div>
                    {isSshPath(folder) && <div className="truncate text-[11px] text-muted-foreground">{remoteAccount(folder)}</div>}
                  </div>
                  <button
                    type="button"
                    aria-label="Refresh"
                    title="Refresh"
                    aria-busy={busy}
                    disabled={busy}
                    onClick={refresh}
                    className="flex h-6 w-6 shrink-0 cursor-pointer disabled:cursor-default disabled:opacity-60 items-center justify-center rounded-control border-0 bg-transparent text-foreground hover:bg-surface focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <RefreshCw size={14} aria-hidden className={busy ? 'animate-spin' : undefined} />
                  </button>
                </div>
                <RefreshTracker.Provider value={tracker}>
                  <Tree key={folder} path={folder} depth={0} refreshKey={refreshKey} currentPath={currentPath} onOpenFile={onOpenFile} onLogin={onLogin} />
                </RefreshTracker.Provider>
              </>
            ) : (
              <>
                <p className="m-0 mb-1 text-[13px] text-muted-foreground">No folder open</p>
                <button type="button" onClick={onOpenFolder} className="cursor-pointer rounded-control border border-solid border-border bg-transparent px-2 py-1 text-[13px] text-foreground hover:bg-surface">
                  Open Folder…
                </button>
              </>
            ))}
        </section>
        <section>
          <SectionHeader label="Recent documents" open={recentOpen} onToggle={() => setRecentOpen((o) => !o)} />
          {recentOpen &&
            (recents.length === 0 ? (
              <p className="m-0 text-[13px] text-muted-foreground">No recent documents.</p>
            ) : (
              <ul className="m-0 list-none p-0">
                {recents.map((r) => (
                  <li key={r.path} className="group flex items-center hover:bg-surface">
                    <button
                      type="button"
                      onClick={() => onOpenRecent(r.path)}
                      title={r.path}
                      className="min-w-0 flex-1 cursor-pointer border-0 bg-transparent py-1 text-left"
                    >
                      <span className="block truncate text-[13px] text-foreground">
                        {basename(r.path)}
                        {parseGithubPath(r.path) !== null && (
                          <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">
                            {parseGithubPath(r.path)!.owner}/{parseGithubPath(r.path)!.repo} @ {parseGithubPath(r.path)!.branch}
                          </span>
                        )}
                        {isSshPath(r.path) && <span className="ml-1.5 text-[11px] font-normal text-muted-foreground">{remoteAccount(r.path)}</span>}
                      </span>
                      <span className="block text-[11px] text-muted-foreground">{relativeTime(r.openedAt)}</span>
                    </button>
                    <button
                      type="button"
                      aria-label={`Remove ${basename(r.path)} from recent documents`}
                      title="Remove from recent"
                      onClick={() => onRemoveRecent(r.path)}
                      className="hidden h-5 w-5 shrink-0 cursor-pointer items-center justify-center border-0 bg-transparent p-0 text-muted-foreground hover:text-foreground focus:flex group-hover:flex"
                    >
                      <X size={12} aria-hidden />
                    </button>
                  </li>
                ))}
              </ul>
            ))}
        </section>
      </nav>
      <div className="w-px shrink-0" style={{ background: 'var(--brass-hairline-v)' }} />
    </aside>
  );
}
