/**
 * The GitHub repository navigator, shown by FolderSidebar when a repo is open: a header (owner/repo, the
 * branch dropdown and the create-branch icon) above a lazily listed folder tree
 * (platform/folders.ts listFolderPage on github:// paths). Switching branch reloads the tree and keeps only
 * the expanded folders that exist on the new branch. The Refresh button (and View > Refresh Navigator, via `refreshSignal`) re-lists the root and the expanded folders (and the branch list) in place, shows a busy state meanwhile, keeps the rows on screen when a re-list fails, and switches to the default branch when the open branch was deleted. Exports RepoNavigator, RepoState, BRANCH_RENDER_CAP and describeError (all from the shared @gonq/editor/controllers/repoTree, which holds the logic; this file draws it).
 */
import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, File, Folder, GitBranch, GitBranchPlus, Loader2, RefreshCw } from 'lucide-react';
import { ensureSignedIn } from '@gonq/editor/platform/github';
import {
  BRANCH_RENDER_CAP,
  ROW_CHUNK,
  describeError,
  errorParts,
  filterBranches,
  useBranchList,
  useRepoTree,
  type RepoState,
} from '@gonq/editor/controllers/repoTree';

export { BRANCH_RENDER_CAP, describeError };
export type { RepoState };

const muted = 'm-0 py-1 text-[12.5px] text-muted-foreground';
const link = 'cursor-pointer border-0 bg-transparent p-0 text-[12.5px] underline';

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
  const { all, loadingMore, error, retry: retryBranches } = useBranchList(owner, repo, extra, refreshKey);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const away = (ev: MouseEvent) => root.current !== null && !root.current.contains(ev.target as Node) && setOpen(false);
    document.addEventListener('mousedown', away);
    return () => document.removeEventListener('mousedown', away);
  }, [open]);

  const { matches, shown } = filterBranches(all, filter);

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
          {error !== null && <ErrorLine e={error} what="loading branches" pad={4} onRetry={retryBranches} />}
        </div>
      )}
    </div>
  );
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
  const { root, listings, expanded, shown, toggle, retry, showMore, refresh, refreshKey, busy, refreshError, branchGone } = useRepoTree(repo, onBranchChange, refreshSignal);

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
                onClick={() => showMore(path)}
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
