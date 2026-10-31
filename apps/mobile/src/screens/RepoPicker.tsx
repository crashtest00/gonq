/**
 * The mobile "Open repository" screen (M-19), the counterpart of the desktop RepoPickerDialog with the same strings: the
 * signed-in user's repositories arrive page by page (listRepos, "Loading more…"), a client-side "Filter by owner/repo"
 * box, rows of owner/repo with "private" and "read-only for you" badges (no description, no time, no count), the
 * empty/no-match texts, the organisations note, an inline-Retry error line and Cancel. A revoked token ends the
 * picker with the signed-out result. Exports repoPickerScreen, which GithubProvider pushes for Open Repo.
 */
import { createElement, useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { listRepos, toGitHubError, type RepoSummary } from '@gonq/editor/platform/github';
import { useGithub } from '../shell/github';
import type { Screen } from '../shell/StackNavigator';

const badge: CSSProperties = { flex: 'none', border: '1px solid var(--border)', borderRadius: 'var(--radius-control)', padding: '0 6px', fontSize: 11, color: 'var(--muted-foreground)' };
const note: CSSProperties = { margin: 0, padding: '0 var(--space-4)', color: 'var(--muted-foreground)' };

export function RepoPicker() {
  const { finishPick } = useGithub();
  const [repos, setRepos] = useState<RepoSummary[]>([]);
  /** The page being (or next to be) loaded; null once the last page arrived. */
  const [next, setNext] = useState<number | null>(1);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState('');
  /** Bumped by a retry; the load effect restarts from `next`. */
  const [attempt, setAttempt] = useState(0);
  const live = useRef(true);
  const finish = useRef(finishPick);
  finish.current = finishPick;

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
        if (err.kind === 'not_signed_in') finish.current({ kind: 'signed-out' });
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)', paddingTop: 'var(--space-3)' }}>
      <input
        type="text"
        aria-label="Filter repositories"
        placeholder="Filter by owner/repo"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        className="m-tap m-field"
      />
      <ul aria-label="Repositories" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {shown.map((r) => (
          <li key={r.fullName} style={{ borderBottom: '1px solid var(--border)' }}>
            <button
              type="button"
              className="m-tap"
              title={r.fullName}
              style={{ width: '100%', justifyContent: 'flex-start', gap: 'var(--space-2)', textAlign: 'left', minHeight: 52 }}
              onClick={() => finishPick({ kind: 'chosen', choice: { owner: r.owner, repo: r.name, defaultBranch: r.defaultBranch } })}
            >
              <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>{r.fullName}</span>
              {r.private && <span style={badge}>private</span>}
              {!r.canPush && <span style={badge}>read-only for you</span>}
            </button>
          </li>
        ))}
      </ul>
      {done && repos.length === 0 && (
        <p role="status" style={note}>
          No repositories found for this account.
        </p>
      )}
      {done && repos.length > 0 && shown.length === 0 && (
        <p role="status" style={note}>
          No repositories match “{filter.trim()}”.
        </p>
      )}
      {loading && (
        <p role="status" style={note}>
          Loading more…
        </p>
      )}
      {error !== null && (
        <p role="alert" style={{ ...note, color: 'var(--destructive)' }}>
          {error}{' '}
          <button type="button" className="m-tap" style={{ textDecoration: 'underline', color: 'var(--destructive)' }} onClick={retry}>
            Retry
          </button>
        </p>
      )}
      <p style={{ ...note, fontSize: 'var(--text-caption)' }}>
        Repositories from organisations that have not authorised the Gonq OAuth App may not appear here.
      </p>
      <div style={{ padding: '0 var(--space-4) var(--space-4)' }}>
        <button type="button" className="m-tap" style={{ border: '1px solid var(--border)', width: '100%' }} onClick={() => finishPick({ kind: 'closed' })}>
          Cancel
        </button>
      </div>
    </div>
  );
}

export const repoPickerScreen: Screen = { key: 'repo-picker', title: 'Open repository', render: () => createElement(RepoPicker) };
