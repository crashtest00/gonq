/**
 * The mobile repo navigator screen (M-19), the counterpart of the desktop RepoNavigator on the shared useRepoTree and
 * useBranchList: the repository name is the screen title; a branch button opens a "Branches" sheet (filter box
 * "Filter branches", rows of a check mark and the name, the cap/loading/empty/error lines); Refresh (always rendered,
 * disabled and busy while listing, with a refresh error line and Retry) re-lists in place; the folder tree lists lazily,
 * and a file opens as a github:// document in the editor. Error wording is describeError's. Wide rows scroll sideways
 * (the .m-hscroll cue). Exports repoScreen(title) for the navigator and REPO_SCREEN_KEY.
 */
import { createElement, useState } from 'react';
import {
  BRANCH_RENDER_CAP,
  ROW_CHUNK,
  errorParts,
  filterBranches,
  useBranchList,
  useRepoTree,
} from '@gonq/editor/controllers/repoTree';
import { ensureSignedIn } from '@gonq/editor/platform/github';
import { BottomSheet } from '../shell/BottomSheet';
import { useDocuments } from '../shell/documents';
import { useGithub } from '../shell/github';
import type { Screen } from '../shell/StackNavigator';

const muted = { margin: 0, padding: '0 var(--space-4)', color: 'var(--muted-foreground)' } as const;
const link = { textDecoration: 'underline', color: 'inherit' } as const;

function ErrorLine({ e, what, pad = 0, onRetry }: { e: unknown; what: string; pad?: number; onRetry: () => void }) {
  const { text, action } = errorParts(e, what);
  const signIn = () => void ensureSignedIn().then((ok) => ok && onRetry(), () => {});
  return (
    <p role="alert" style={{ ...muted, paddingLeft: `calc(var(--space-4) + ${pad}px)`, color: 'var(--destructive)' }}>
      {text}
      {action !== null && (
        <>
          {' '}
          <button type="button" className="m-tap" style={link} onClick={action === 'retry' ? onRetry : signIn}>
            {action === 'retry' ? 'Retry' : 'Sign in'}
          </button>
        </>
      )}
    </p>
  );
}

function BranchSheet({ owner, repo, branch, extra, refreshKey, onSelect, onClose }: { owner: string; repo: string; branch: string; extra: string[]; refreshKey: number; onSelect: (b: string) => void; onClose: () => void }) {
  const [filter, setFilter] = useState('');
  const { all, loadingMore, error, retry } = useBranchList(owner, repo, extra, refreshKey);
  const { matches, shown } = filterBranches(all, filter);
  return (
    <BottomSheet open title="Branches" onClose={onClose}>
      <input type="text" aria-label="Filter branches" placeholder="Filter branches" value={filter} onChange={(e) => setFilter(e.target.value)} className="m-tap m-field" style={{ margin: 0, width: '100%' }} />
      <ul role="listbox" aria-label="Branches" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((b) => (
          <li key={b} role="presentation">
            <button
              type="button"
              role="option"
              aria-selected={b === branch}
              title={b}
              className="m-tap m-tree-row"
              onClick={() => {
                onClose();
                if (b !== branch) onSelect(b);
              }}
            >
              <span aria-hidden style={{ width: 16, visibility: b === branch ? 'visible' : 'hidden' }}>✓</span>
              <span style={{ overflowWrap: 'anywhere', whiteSpace: 'normal' }}>{b}</span>
            </button>
          </li>
        ))}
      </ul>
      {matches.length > shown.length && (
        <p style={{ ...muted, padding: 0 }}>
          Showing the first {BRANCH_RENDER_CAP} of {matches.length} branches. Type to narrow the list.
        </p>
      )}
      {matches.length === 0 && !loadingMore && error === null && <p style={{ ...muted, padding: 0 }}>{all.length === 0 ? 'No branches.' : 'No branch matches.'}</p>}
      {loadingMore && (
        <p role="status" style={{ ...muted, padding: 0 }}>
          Loading more…
        </p>
      )}
      {error !== null && <ErrorLine e={error} what="loading branches" onRetry={retry} />}
    </BottomSheet>
  );
}

export function RepoScreen() {
  const gh = useGithub();
  const doc = useDocuments();
  const [branchesOpen, setBranchesOpen] = useState(false);
  const repo = gh.repo;
  if (repo === null) return null;
  return <RepoTree repo={repo} gh={gh} currentPath={doc.session.meta?.path ?? null} onOpenFile={(p) => void doc.openKnownPath(p, false)} branchesOpen={branchesOpen} setBranchesOpen={setBranchesOpen} />;
}

function RepoTree({ repo, gh, currentPath, onOpenFile, branchesOpen, setBranchesOpen }: { repo: NonNullable<ReturnType<typeof useGithub>['repo']>; gh: ReturnType<typeof useGithub>; currentPath: string | null; onOpenFile: (path: string) => void; branchesOpen: boolean; setBranchesOpen: (o: boolean) => void }) {
  const { root, listings, expanded, shown, toggle, retry, showMore, refresh, refreshKey, busy, refreshError, branchGone } = useRepoTree(repo, (b) => void gh.changeBranch(b), gh.navRefresh);
  const created = gh.createdBranches.filter((b) => b.owner === repo.owner && b.repo === repo.repo).map((b) => b.branch);

  const renderLevel = (path: string, depth: number) => {
    const l = listings.get(path);
    const pad = depth * 16;
    const indent = { paddingLeft: `calc(var(--space-4) + ${pad}px)` };
    if (l === undefined || l.state === 'loading')
      return (
        <p role="status" style={{ ...muted, ...indent }}>
          Loading…
        </p>
      );
    if (l.state === 'error') return <ErrorLine e={l.error} what="listing this folder" pad={pad} onRetry={() => retry(path)} />;
    if (l.entries.length === 0 && !l.truncated)
      return <p style={{ ...muted, ...indent }}>{depth === 0 ? 'No Markdown files in this branch.' : 'No Markdown files in this folder.'}</p>;
    const count = shown.get(path) ?? ROW_CHUNK;
    const remaining = l.entries.length - count;
    return (
      <>
        <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {l.entries.slice(0, count).map((entry) => (
            <li key={entry.path}>
              {entry.isDir ? (
                <>
                  <button type="button" className="m-tap m-tree-row" aria-expanded={expanded.has(entry.path)} title={entry.name} style={indent} onClick={() => toggle(entry.path)}>
                    <span aria-hidden>{expanded.has(entry.path) ? '▾' : '▸'}</span>
                    <span>{entry.name}</span>
                  </button>
                  {expanded.has(entry.path) && renderLevel(entry.path, depth + 1)}
                </>
              ) : (
                <button type="button" className="m-tap m-tree-row" aria-current={entry.path === currentPath ? 'true' : undefined} title={entry.name} style={indent} onClick={() => onOpenFile(entry.path)}>
                  <span aria-hidden>▫</span>
                  <span>{entry.name}</span>
                </button>
              )}
            </li>
          ))}
          {remaining > 0 && (
            <li>
              <button type="button" className="m-tap m-tree-row" style={{ ...indent, color: 'var(--muted-foreground)' }} onClick={() => showMore(path)}>
                Show more ({remaining} more)
              </button>
            </li>
          )}
        </ul>
        {l.truncated && (
          <p role="note" style={{ ...muted, ...indent }}>
            Showing what GitHub returned; the folder may have more.
          </p>
        )}
      </>
    );
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingTop: 'var(--space-2)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', padding: '0 var(--space-3)' }}>
        <button
          type="button"
          className="m-tap"
          aria-haspopup="listbox"
          aria-expanded={branchesOpen}
          aria-label={`Branch: ${repo.branch}`}
          title={repo.branch}
          style={{ flex: 1, minWidth: 0, justifyContent: 'flex-start', border: '1px solid var(--border)' }}
          onClick={() => setBranchesOpen(true)}
        >
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{repo.branch}</span>
        </button>
        <button type="button" className="m-tap" aria-label="Refresh" title="Refresh" aria-busy={busy} disabled={busy} style={{ border: '1px solid var(--border)' }} onClick={refresh}>
          {busy ? 'Refreshing…' : '⟳'}
        </button>
      </div>
      {branchesOpen && (
        <BranchSheet owner={repo.owner} repo={repo.repo} branch={repo.branch} extra={created} refreshKey={refreshKey} onSelect={(b) => void gh.changeBranch(b)} onClose={() => setBranchesOpen(false)} />
      )}
      {refreshError !== null && !branchGone && <ErrorLine e={refreshError} what="refreshing the navigator" onRetry={refresh} />}
      {branchGone ? (
        <p role="alert" style={{ ...muted, color: 'var(--destructive)' }}>
          The branch “{repo.branch}” no longer exists on GitHub. Choose another branch.
        </p>
      ) : (
        <div className="m-hscroll" role="group" aria-label="Files" tabIndex={0}>
          <div style={{ minWidth: '100%', width: 'max-content' }}>{renderLevel(root, 0)}</div>
        </div>
      )}
    </div>
  );
}

export const REPO_SCREEN_KEY = 'repo';

/** The navigator screen for `title` (owner/repo). */
export const repoScreen = (title: string): Screen => ({ key: REPO_SCREEN_KEY, title, render: () => createElement(RepoScreen) });
