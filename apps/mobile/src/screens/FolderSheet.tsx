/**
 * The mobile Folder navigator (M-31), the counterpart of the desktop FolderSidebar's Project folder section on the shared
 * folder-listing controller (useFolderListing / useNavigatorRefresh): <FolderButton/> is the mobile-only top-bar button
 * (outside the command registry) and <FolderSheet/> the bottom sheet it opens. Section "Project folder"; the title is the
 * folder's base name only; with nothing open "No folder open", a disabled Refresh and "Open Folder…". Rows are folders and Markdown
 * files, listed lazily ("Loading…", "No Markdown files." for an empty folder, "Empty." for an empty subfolder), the open file is
 * aria-current, and tapping a file opens it and closes the sheet. Refresh is always rendered, disabled with nothing open or
 * while listing, checks the grant first (a revoked or missing one goes to the error banner and removes the recent), then re-lists
 * in place keeping expanded folders; no timers or watchers. The tree stays mounted while the sheet is closed so expansion survives.
 */
import { createContext, memo, useContext, useState } from 'react';
import { ROW_CHUNK, useFolderListing, useNavigatorRefresh, type RefreshTracker } from '@gonq/editor/controllers/folderListing';
import type { FolderEntry } from '@gonq/editor/platform/folders';
import { BottomSheet } from '../shell/BottomSheet';
import { useDocuments } from '../shell/documents';
import { useFolder } from '../shell/folder';

const muted = { margin: 0, padding: '0 var(--space-4)', color: 'var(--muted-foreground)' } as const;
const TrackerContext = createContext<RefreshTracker | null>(null);

const Row = memo(function Row({ entry, depth, expanded, currentPath, refreshKey, onToggle, onOpenFile }: { entry: FolderEntry; depth: number; expanded: boolean; currentPath: string | null; refreshKey: number; onToggle: (path: string) => void; onOpenFile: (path: string) => void }) {
  const indent = { paddingLeft: `calc(var(--space-4) + ${depth * 16}px)` };
  return (
    <li>
      {entry.isDir ? (
        <>
          <button type="button" className="m-tap m-tree-row" aria-expanded={expanded} title={entry.name} style={indent} onClick={() => onToggle(entry.path)}>
            <span aria-hidden>{expanded ? '▾' : '▸'}</span>
            <span>{entry.name}</span>
          </button>
          {expanded && <Tree path={entry.path} depth={depth + 1} currentPath={currentPath} refreshKey={refreshKey} onOpenFile={onOpenFile} />}
        </>
      ) : (
        <button type="button" className="m-tap m-tree-row" aria-current={entry.path === currentPath ? 'true' : undefined} title={entry.name} style={indent} onClick={() => onOpenFile(entry.path)}>
          <span aria-hidden>▫</span>
          <span>{entry.name}</span>
        </button>
      )}
    </li>
  );
});

function Tree({ path, depth, currentPath, refreshKey, onOpenFile }: { path: string; depth: number; currentPath: string | null; refreshKey: number; onOpenFile: (path: string) => void }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const tracker = useContext(TrackerContext);
  const { entries, error, refreshError, shown, showMore } = useFolderListing(path, refreshKey, tracker);
  const indent = { paddingLeft: `calc(var(--space-4) + ${depth * 16}px)` };
  const toggle = (p: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (!next.delete(p)) next.add(p);
      return next;
    });
  if (error !== null)
    return (
      <p role="alert" style={{ ...muted, ...indent, color: 'var(--destructive)' }}>
        {error}
      </p>
    );
  if (entries === null) return <p style={{ ...muted, ...indent }}>Loading…</p>;
  if (entries.length === 0) return <p style={{ ...muted, ...indent }}>{depth === 0 ? 'No Markdown files.' : 'Empty.'}</p>;
  const remaining = entries.length - shown;
  return (
    <>
      {refreshError !== null && (
        <p role="alert" style={{ ...muted, ...indent, color: 'var(--destructive)' }}>
          Could not refresh: {refreshError}
        </p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {entries.slice(0, shown).map((entry) => (
          <Row key={entry.path} entry={entry} depth={depth} expanded={expanded.has(entry.path)} currentPath={currentPath} refreshKey={refreshKey} onToggle={toggle} onOpenFile={onOpenFile} />
        ))}
        {remaining > 0 && (
          <li>
            <button type="button" className="m-tap m-tree-row" style={{ ...indent, color: 'var(--muted-foreground)' }} onClick={showMore}>
              Show more ({remaining} more)
            </button>
          </li>
        )}
      </ul>
    </>
  );
}

const refreshButton = (props: { disabled: boolean; busy?: boolean; onClick?: () => void }) => (
  <button type="button" className="m-tap" aria-label="Refresh" title="Refresh" aria-busy={props.busy} disabled={props.disabled} style={{ border: '1px solid var(--border)', flex: 'none' }} onClick={props.onClick}>
    {props.busy ? 'Refreshing…' : '⟳'}
  </button>
);

export function FolderSheet() {
  const f = useFolder();
  const doc = useDocuments();
  const { refreshKey, refresh, busy, tracker } = useNavigatorRefresh();
  const [checking, setChecking] = useState(false);
  // Mounted from the first time it is opened, then kept (hidden) so expanded folders survive closing it.
  const [everOpened, setEverOpened] = useState(false);
  if (f.sheetOpen && !everOpened) setEverOpened(true);
  if (!f.sheetOpen && !everOpened) return null;

  const onRefresh = async () => {
    if (busy || checking) return;
    setChecking(true);
    try {
      if (await f.verify()) refresh();
    } finally {
      setChecking(false);
    }
  };
  const working = busy || checking;
  return (
    <BottomSheet open={f.sheetOpen} keepMounted title="Folder navigator" onClose={f.closeSheet}>
      <div className="m-label" style={{ padding: 'var(--space-3) 0 var(--space-1)' }}>
        Project folder
      </div>
      {f.folder === null ? (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <p style={{ ...muted, flex: 1, padding: 0 }}>No folder open</p>
            {refreshButton({ disabled: true })}
          </div>
          <button type="button" className="m-tap m-outline m-block" onClick={() => void f.openFolder()}>
            Open Folder…
          </button>
        </>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <div title={f.name ?? undefined} style={{ flex: 1, minWidth: 0, fontWeight: 'var(--weight-semibold)', overflowWrap: 'anywhere' }}>
              {f.name}
            </div>
            {refreshButton({ disabled: working, busy: working, onClick: () => void onRefresh() })}
          </div>
          <div className="m-hscroll" role="group" aria-label="Files" tabIndex={0}>
            <div style={{ minWidth: '100%', width: 'max-content' }}>
              <TrackerContext.Provider value={tracker}>
                <Tree
                  key={f.folder}
                  path={f.folder}
                  depth={0}
                  refreshKey={refreshKey}
                  currentPath={doc.session.meta?.path ?? null}
                  onOpenFile={(p) => {
                    f.closeSheet();
                    void doc.openKnownPath(p, false);
                  }}
                />
              </TrackerContext.Provider>
            </div>
          </div>
        </>
      )}
    </BottomSheet>
  );
}

/** The mobile-only top-bar button that opens the Folder navigator sheet. */
export function FolderButton() {
  const f = useFolder();
  return (
    <button type="button" className="m-tap" aria-label="Folder navigator" title="Folder navigator" aria-haspopup="dialog" aria-expanded={f.sheetOpen} onClick={f.openSheet}>
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      </svg>
    </button>
  );
}
