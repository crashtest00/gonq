/**
 * File > Open Repo… dialog: loads the user's GitHub repositories page by page (platform/github.ts listRepos),
 * filters them, and reports the chosen RepoChoice to App.tsx.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { listRepos, toGitHubError, type RepoSummary } from '@gonq/editor/platform/github';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring';
const badge = 'shrink-0 rounded-control border border-border px-1.5 text-[11px] text-muted-foreground';

export interface RepoChoice {
  owner: string;
  repo: string;
  defaultBranch: string;
}

/**
 * File > Open Repo…: lists the signed-in user's repositories page by page (rows appear as each page
 * arrives), with a client-side filter on owner/repo. Choosing one calls `onChoose`; a revoked token
 * (not_signed_in, also when the user signed out elsewhere mid-load) calls `onSignedOut`.
 */
export function RepoPickerDialog({
  onChoose,
  onClose,
  onSignedOut,
}: {
  onChoose: (choice: RepoChoice) => void;
  onClose: () => void;
  onSignedOut: () => void;
}) {
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  /** The page being (or next to be) loaded; null once the last page arrived. */
  const [next, setNext] = useState<number | null>(1);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  /** Bumped by a retry; the load effect restarts from `next`. */
  const [attempt, setAttempt] = useState(0);
  const live = useRef(true);
  const signedOut = useRef(onSignedOut);
  signedOut.current = onSignedOut;

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  useEffect(() => {
    if (next === null || error !== null) return;
    let stale = false;
    listRepos(next).then(
      (page) => {
        if (stale || !live.current) return;
        setRepos((r) => [...r, ...page.repos]);
        setNext(page.nextPage);
      },
      (e: unknown) => {
        if (stale || !live.current) return;
        const err = toGitHubError(e);
        if (err.kind === 'not_signed_in') signedOut.current();
        else setError(err.message);
      },
    );
    return () => {
      stale = true;
    };
    // `next` advances only when a page lands, so this runs once per page (and again after a retry).
  }, [next, error, attempt]);

  const retry = useCallback(() => {
    setError(null);
    setAttempt((a) => a + 1);
  }, []);

  const indexed = useMemo(() => repos.map((r) => ({ r, key: r.fullName.toLowerCase() })), [repos]);
  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q === '' ? repos : indexed.filter((x) => x.key.includes(q)).map((x) => x.r);
  }, [filter, indexed, repos]);

  const loading = next !== null && error === null;
  const done = next === null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="repo-picker-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        className="flex max-h-[80vh] w-[520px] max-w-[90vw] flex-col rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="repo-picker-title" className="m-0 mb-3 text-[15px] font-semibold">
          Open repository
        </h2>
        <input
          type="text"
          aria-label="Filter repositories"
          placeholder="Filter by owner/repo"
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="mb-3 h-8 rounded-control border border-border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <ul aria-label="Repositories" className="m-0 mb-2 min-h-[120px] flex-1 list-none overflow-y-auto p-0">
          {shown.map((r) => (
            <li key={r.fullName}>
              <button
                type="button"
                onClick={() => onChoose({ owner: r.owner, repo: r.name, defaultBranch: r.defaultBranch })}
                className="flex w-full cursor-pointer items-center gap-2 rounded-control border-0 bg-transparent px-2 py-1.5 text-left text-[13px] text-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className="min-w-0 flex-1 truncate">{r.fullName}</span>
                {r.private && <span className={badge}>private</span>}
                {!r.canPush && <span className={badge}>read-only for you</span>}
              </button>
            </li>
          ))}
        </ul>
        {done && repos.length === 0 && (
          <p role="status" className="m-0 mb-2 text-[13px] text-muted-foreground">
            No repositories found for this account.
          </p>
        )}
        {done && repos.length > 0 && shown.length === 0 && (
          <p role="status" className="m-0 mb-2 text-[13px] text-muted-foreground">
            No repositories match “{filter.trim()}”.
          </p>
        )}
        {loading && (
          <p role="status" className="m-0 mb-2 flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 size={14} aria-hidden className="animate-spin" />
            Loading more…
          </p>
        )}
        {error !== null && (
          <p role="alert" className="m-0 mb-2 text-[13px] text-destructive">
            {error}{' '}
            <button type="button" onClick={retry} className="cursor-pointer underline">
              Retry
            </button>
          </p>
        )}
        <p className="m-0 mb-4 text-[12px] text-muted-foreground">
          Repositories from organisations that have not authorised the Gonq OAuth App may not appear here.
        </p>
        <div className="flex justify-end">
          <button type="button" onClick={onClose} className={`${button} border-border bg-transparent`}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
