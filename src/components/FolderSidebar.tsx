import { memo, useCallback, useEffect, useState } from 'react';
import { ChevronRight, File, Folder, Loader2, X } from 'lucide-react';
import { ListDirectoryError, listDirectory, type FolderEntry } from '../platform/folders';
import type { RecentDocument } from '../platform/recents';
import { isSshPath, remoteAccount, remoteFileName } from '../platform/remote';

export function basename(path: string): string {
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

const Row = memo(function Row({
  entry,
  depth,
  expanded,
  currentPath,
  onToggle,
  onOpenFile,
  onLogin,
}: {
  entry: FolderEntry;
  depth: number;
  expanded: boolean;
  currentPath: string | null;
  onToggle: (path: string) => void;
  onOpenFile: (path: string) => void;
  onLogin?: (path: string) => void;
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
          {expanded && <Tree path={entry.path} depth={depth + 1} currentPath={currentPath} onOpenFile={onOpenFile} onLogin={onLogin} />}
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

function Tree({ path, depth, currentPath, onOpenFile, onLogin }: { path: string; depth: number; currentPath: string | null; onOpenFile: (path: string) => void; onLogin?: (path: string) => void }) {
  const [entries, setEntries] = useState<FolderEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [shown, setShown] = useState(ROW_CHUNK);
  const [errorKind, setErrorKind] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  // A remote listing shows its spinner only once it has taken longer than 150 ms.
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    let live = true;
    setEntries(null);
    setErrorKind(null);
    setError(null);
    setShown(ROW_CHUNK);
    listDirectory(path).then(
      (rows) => live && setEntries(rows),
      (e) => {
        if (!live) return;
        setErrorKind(e instanceof ListDirectoryError ? e.kind : null);
        setError(e instanceof ListDirectoryError || e instanceof Error ? e.message : String(e));
      },
    );
    return () => {
      live = false;
    };
  }, [path, attempt]);

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
            <button type="button" onClick={() => onLogin(path)} className="cursor-pointer border-0 bg-transparent p-0 text-[12.5px] text-destructive underline">
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
    <ul className="m-0 list-none p-0">
      {entries.slice(0, shown).map((entry) => (
        <Row
          key={entry.path}
          entry={entry}
          depth={depth}
          expanded={expanded.has(entry.path)}
          currentPath={currentPath}
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
  );
}

export function FolderSidebar({
  supported,
  folder,
  recents,
  currentPath,
  onOpenFolder,
  onOpenFile,
  onLogin,
  onOpenRecent,
  onRemoveRecent,
}: {
  supported: boolean;
  folder: string | null;
  recents: RecentDocument[];
  currentPath: string | null;
  onOpenFolder: () => void;
  onOpenFile: (path: string) => void;
  /** Reopens the Connect dialog for a remote folder whose login ran out; no Log in button without it. */
  onLogin?: (path: string) => void;
  onOpenRecent: (path: string) => void;
  onRemoveRecent: (path: string) => void;
}) {
  const [projectOpen, setProjectOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(true);

  return (
    <aside aria-label="Folder navigator" className="flex w-[240px] shrink-0 overflow-hidden">
      <nav className="min-w-0 flex-1 overflow-y-auto px-4 py-3">
        <section className="mb-4">
          <SectionHeader label="Project folder" open={projectOpen} onToggle={() => setProjectOpen((o) => !o)} />
          {projectOpen &&
            (folder !== null ? (
              <>
                <div title={folder} className="mb-1 min-w-0">
                  <div className="truncate text-[12.5px] font-semibold text-foreground">{isSshPath(folder) ? remoteFolderName(folder) : basename(folder)}</div>
                  {isSshPath(folder) && <div className="truncate text-[11px] text-muted-foreground">{remoteAccount(folder)}</div>}
                </div>
                <Tree key={folder} path={folder} depth={0} currentPath={currentPath} onOpenFile={onOpenFile} onLogin={onLogin} />
              </>
            ) : (
              <>
                <p className="m-0 mb-1 text-[13px] text-muted-foreground">No folder open</p>
                {supported ? (
                  <button type="button" onClick={onOpenFolder} className="cursor-pointer rounded-control border border-solid border-border bg-transparent px-2 py-1 text-[13px] text-foreground hover:bg-surface">
                    Open Folder…
                  </button>
                ) : (
                  <p className="m-0 text-[13px] text-muted-foreground">Opening a folder is available in the desktop app.</p>
                )}
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
