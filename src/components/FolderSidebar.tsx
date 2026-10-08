import { useCallback, useEffect, useState } from 'react';
import { ChevronRight, File, Folder, X } from 'lucide-react';
import { ListDirectoryError, listDirectory, type FolderEntry } from '../platform/folders';
import type { RecentDocument } from '../platform/recents';

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

function Tree({ path, depth, currentPath, onOpenFile }: { path: string; depth: number; currentPath: string | null; onOpenFile: (path: string) => void }) {
  const [entries, setEntries] = useState<FolderEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    setEntries(null);
    setError(null);
    listDirectory(path).then(
      (rows) => live && setEntries(rows),
      (e) => live && setError(e instanceof ListDirectoryError || e instanceof Error ? e.message : String(e)),
    );
    return () => {
      live = false;
    };
  }, [path]);

  const toggle = useCallback((p: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(p)) next.add(p);
      return next;
    });
  }, []);

  const pad = { paddingLeft: depth * 14 };
  if (error !== null) return <p role="alert" style={pad} className="m-0 py-1 text-[12.5px] text-destructive">{error}</p>;
  if (entries === null) return <p style={pad} className="m-0 py-1 text-[12.5px] text-muted-foreground">Loading…</p>;
  if (entries.length === 0) return <p style={pad} className="m-0 py-1 text-[12.5px] text-muted-foreground">{depth === 0 ? 'No Markdown files.' : 'Empty.'}</p>;

  return (
    <ul className="m-0 list-none p-0">
      {entries.map((entry) => (
        <li key={entry.path}>
          {entry.isDir ? (
            <>
              <button
                type="button"
                aria-expanded={expanded.has(entry.path)}
                onClick={() => toggle(entry.path)}
                title={entry.path}
                style={pad}
                className="flex w-full cursor-pointer items-center gap-1.5 border-0 bg-transparent py-1 text-left text-[13px] text-foreground hover:bg-surface"
              >
                <Folder size={12} aria-hidden className="shrink-0 fill-current" />
                <span className="truncate">{entry.name}</span>
              </button>
              {expanded.has(entry.path) && <Tree path={entry.path} depth={depth + 1} currentPath={currentPath} onOpenFile={onOpenFile} />}
            </>
          ) : (
            <button
              type="button"
              aria-current={entry.path === currentPath ? 'true' : undefined}
              onClick={() => onOpenFile(entry.path)}
              title={entry.path}
              style={pad}
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
  onOpenRecent,
  onRemoveRecent,
}: {
  supported: boolean;
  folder: string | null;
  recents: RecentDocument[];
  currentPath: string | null;
  onOpenFolder: () => void;
  onOpenFile: (path: string) => void;
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
                <div title={folder} className="mb-1 truncate text-[12.5px] font-semibold text-foreground">{basename(folder)}</div>
                <Tree key={folder} path={folder} depth={0} currentPath={currentPath} onOpenFile={onOpenFile} />
              </>
            ) : supported ? (
              <button type="button" onClick={onOpenFolder} className="cursor-pointer rounded-control border border-solid border-border bg-transparent px-2 py-1 text-[13px] text-foreground hover:bg-surface">
                Open Folder…
              </button>
            ) : (
              <p className="m-0 text-[13px] text-muted-foreground">Opening a folder is available in the desktop app.</p>
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
                      <span className="block truncate text-[13px] text-foreground">{basename(r.path)}</span>
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
