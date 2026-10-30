/**
 * File > Open PR…: a dialog laid out left to right in three steps (Branch to merge, Merge into, Review changes),
 * each shown only once its inputs exist, under a repository dropdown (changing it rebuilds step 1 and clears the
 * rest). Open PR leads to an editable title and body (defaults from features/github/prDefaults.ts), whose Open PR
 * button is the confirmation; then a result with the link and Open in browser, plus a non-blocking note when the backend could not label the pull request. GitHub's own messages are shown
 * unchanged. The platform calls are in platform/github.ts and the pure parts in features/github/openPr.ts; the
 * dialog resolves when closed and reports an opened pull request through `onOpened`.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { openLink } from '@gonq/editor/editor/openLink';
import {
  branchesExist,
  compareBranches,
  createPull,
  listBranches,
  openPullsForBranches,
  toGitHubError,
  type Comparison,
  type CreatedPull,
  type OpenPull,
} from '@gonq/editor/platform/github';
import { NO_CHANGES, NO_SOURCES, describeFile, repoKey, repoOptions, sameRepo, sourceCandidates, type RepoRef } from '@gonq/editor/features/github/openPr';
import { defaultPrBody, defaultPrTitle } from '@gonq/editor/features/github/prDefaults';
import type { SessionBranch } from '@gonq/editor/features/github/sessionBranches';
import { BRANCH_RENDER_CAP } from './RepoNavigator';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';
const primary = `${button} border-primary bg-primary text-primary-foreground`;
const secondary = `${button} border-border bg-transparent`;
const field = 'h-8 w-full rounded-control border border-border bg-background px-2 text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring';
const muted = 'text-[12.5px] text-muted-foreground';

export const alreadyOpenMessage = (n: number): string => `Pull request #${n} is already open for this branch`;

function PullLink({ pull, children }: { pull: { number: number; url: string }; children?: string }) {
  return (
    <a
      href={pull.url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        e.preventDefault();
        openLink(pull.url);
      }}
      className="text-primary underline"
    >
      {children ?? `#${pull.number}`}
    </a>
  );
}

const message = (e: unknown): string => toGitHubError(e).message;

type Load<T> = { state: 'loading' } | { state: 'error'; message: string } | { state: 'ready'; value: T };

interface Sources {
  names: string[];
  pulls: Map<string, OpenPull | null>;
  /** A failed pull request lookup: the branches are still listed, without marks. */
  pullsError: string | null;
}

export interface OpenedPr {
  owner: string;
  repo: string;
  branch: string;
  pull: CreatedPull;
}

export function OpenPrDialog({
  preferred,
  tabBranches,
  sessionBranches,
  onOpened,
  onClose,
}: {
  /** The repository the dropdown starts on (the navigator's). */
  preferred: RepoRef | null;
  tabBranches: SessionBranch[];
  sessionBranches: SessionBranch[];
  onOpened: (opened: OpenedPr) => void;
  onClose: () => void;
}) {
  const repos = useMemo(() => repoOptions(preferred, tabBranches, sessionBranches), [preferred, tabBranches, sessionBranches]);
  const [repo, setRepo] = useState<RepoRef | null>(repos[0] ?? null);
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [screen, setScreen] = useState<'steps' | 'details' | 'done'>('steps');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedPull | null>(null);
  const inFlight = useRef(false);

  // Step 1: the candidates, each checked to still exist, and which have an open pull request.
  const [sources, setSources] = useState<Load<Sources>>({ state: 'loading' });
  useEffect(() => {
    setSource(null);
    setTarget(null);
    setScreen('steps');
    setError(null);
    if (repo === null) return;
    let live = true;
    setSources({ state: 'loading' });
    (async () => {
      const wanted = sourceCandidates(repo, sessionBranches, tabBranches);
      const present = new Set(await branchesExist(repo.owner, repo.repo, wanted));
      const names = wanted.filter((b) => present.has(b));
      let pulls = new Map<string, OpenPull | null>();
      let pullsError: string | null = null;
      try {
        pulls = await openPullsForBranches(repo.owner, repo.repo, names);
      } catch (e) {
        pullsError = message(e);
      }
      if (live) setSources({ state: 'ready', value: { names, pulls, pullsError } });
    })().catch((e) => live && setSources({ state: 'error', message: message(e) }));
    return () => {
      live = false;
    };
  }, [repo === null ? null : repoKey(repo)]);

  // Step 2: every branch of the repository, fetched when a source is first chosen.
  const [branches, setBranches] = useState<Load<string[]>>({ state: 'loading' });
  const wantBranches = source !== null;
  useEffect(() => {
    if (repo === null || !wantBranches) return;
    let live = true;
    setBranches({ state: 'loading' });
    (async () => {
      const all: string[] = [];
      for (let page: number | null = 1; page !== null; ) {
        const p = await listBranches(repo.owner, repo.repo, page);
        for (const b of p.branches) if (!all.includes(b)) all.push(b);
        page = p.nextPage;
      }
      if (live) setBranches({ state: 'ready', value: all });
    })().catch((e) => live && setBranches({ state: 'error', message: message(e) }));
    return () => {
      live = false;
    };
  }, [repo === null ? null : repoKey(repo), wantBranches]);

  const sourcePull = source !== null && sources.state === 'ready' ? (sources.value.pulls.get(source) ?? null) : null;

  // Step 3: the comparison, refreshed whenever either branch changes.
  const [compare, setCompare] = useState<Load<Comparison>>({ state: 'loading' });
  useEffect(() => {
    if (repo === null || source === null || target === null || sourcePull !== null) return;
    let live = true;
    setCompare({ state: 'loading' });
    compareBranches(repo.owner, repo.repo, target, source).then(
      (value) => live && setCompare({ state: 'ready', value }),
      (e) => live && setCompare({ state: 'error', message: message(e) }),
    );
    return () => {
      live = false;
    };
  }, [repo === null ? null : repoKey(repo), source, target, sourcePull !== null]);

  const changeRepo = (key: string) => {
    const next = repos.find((r) => repoKey(r) === key) ?? null;
    if (next !== null && repo !== null && sameRepo(next, repo)) return;
    setSource(null);
    setTarget(null);
    setRepo(next);
    setBranches({ state: 'loading' });
  };

  const toDetails = () => {
    if (source === null || target === null || compare.state !== 'ready') return;
    setTitle(defaultPrTitle(source));
    setBody(
      defaultPrBody({
        source,
        target,
        files: compare.value.files.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          ...(f.previousFilename !== null ? { previous_filename: f.previousFilename } : {}),
        })),
      }),
    );
    setError(null);
    setScreen('details');
  };

  const open = async () => {
    if (inFlight.current || repo === null || source === null || target === null) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const pull = await createPull({ owner: repo.owner, repo: repo.repo, title, body, head: source, base: target });
      setCreated(pull);
      setScreen('done');
      onOpened({ owner: repo.owner, repo: repo.repo, branch: source, pull });
    } catch (e) {
      setError(message(e));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const noChanges = compare.state === 'ready' && compare.value.aheadBy === 0 && compare.value.files.length === 0 && !compare.value.truncated;
  const canOpen = sourcePull === null && source !== null && target !== null && compare.state === 'ready' && !noChanges;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="open-pr-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        className="flex max-h-[calc(100vh-2rem)] w-[980px] max-w-[calc(100vw-2rem)] flex-col rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="open-pr-title" className="m-0 mb-3 text-[15px] font-semibold">
          {screen === 'done' ? 'Pull request opened' : 'Open pull request'}
        </h2>

        {screen === 'steps' && (
          <>
            <label className="mb-3 flex items-center gap-2 text-[13px]">
              <span className="shrink-0 text-muted-foreground">Repository</span>
              <select aria-label="Repository" value={repo === null ? '' : repoKey(repo)} onChange={(e) => changeRepo(e.target.value)} className={field}>
                {repos.map((r) => (
                  <option key={repoKey(r)} value={repoKey(r)}>
                    {repoKey(r)}
                  </option>
                ))}
              </select>
            </label>
            <div className="grid min-h-0 flex-1 grid-cols-3 gap-4">
              <SourcePane sources={sources} source={source} onChoose={(b) => { setSource(b); setTarget(null); }} />
              {source !== null && <TargetPane branches={branches} source={source} target={target} onChoose={setTarget} />}
              {source !== null && (sourcePull !== null || target !== null) && (
                <section aria-label="Review changes" className="flex min-h-0 min-w-0 flex-col">
                  <h3 className="m-0 mb-2 text-[13px] font-semibold">Review changes</h3>
                  {sourcePull !== null ? (
                    <p role="status" className="m-0 text-[13px]">
                      {alreadyOpenMessage(sourcePull.number)}: <PullLink pull={sourcePull} />
                    </p>
                  ) : (
                    <Review compare={compare} target={target!} />
                  )}
                </section>
              )}
            </div>
            <div className="mt-4 flex flex-row-reverse justify-start gap-2">
              {sourcePull === null && (
                <button type="button" disabled={!canOpen} onClick={toDetails} className={primary}>
                  Open PR
                </button>
              )}
              <button type="button" onClick={onClose} className={secondary}>
                Cancel
              </button>
            </div>
          </>
        )}

        {screen === 'details' && (
          <form
            className="flex min-h-0 flex-col"
            onSubmit={(e) => {
              e.preventDefault();
              void open();
            }}
          >
            <p className="m-0 mb-3 break-all text-[13px] text-muted-foreground">
              {repoKey(repo!)}: {source} into {target}
            </p>
            <label className="mb-3 block text-[13px]">
              <span className="mb-1 block text-muted-foreground">Title</span>
              <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
            </label>
            <label className="mb-3 block min-h-0 text-[13px]">
              <span className="mb-1 block text-muted-foreground">Description</span>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                rows={14}
                className="w-full resize-y rounded-control border border-border bg-background p-2 font-mono text-[12.5px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
            {error !== null && (
              <p role="alert" className="m-0 mb-3 break-words text-[13px] text-destructive">
                {error}
              </p>
            )}
            <div className="flex flex-row-reverse justify-start gap-2">
              <button type="submit" disabled={busy} className={primary}>
                Open PR
              </button>
              <button type="button" onClick={onClose} className={secondary}>
                Cancel
              </button>
              <button type="button" disabled={busy} onClick={() => { setError(null); setScreen('steps'); }} className={`${secondary} mr-auto`}>
                Back
              </button>
            </div>
          </form>
        )}

        {screen === 'done' && created !== null && (
          <>
            <p className="m-0 mb-4 text-[13px]">
              Pull request <PullLink pull={created} /> was opened for {source}.
            </p>
            {created.labelWarning !== undefined && (
              <p role="note" className="m-0 mb-4 break-words text-[13px] text-muted-foreground">
                Pull request created, but its label could not be added: {created.labelWarning}
              </p>
            )}
            <div className="flex flex-row-reverse justify-start gap-2">
              <button type="button" onClick={() => openLink(created.url)} className={primary}>
                Open in browser
              </button>
              <button type="button" onClick={onClose} className={secondary}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

const listClass = 'm-0 max-h-[320px] list-none overflow-y-auto rounded-control border border-border p-0';
const rowClass = (on: boolean) =>
  `flex w-full min-w-0 items-center gap-2 border-0 px-2 py-1 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring ${on ? 'bg-accent text-accent-foreground' : 'bg-transparent text-foreground hover:bg-muted'}`;

function SourcePane({ sources, source, onChoose }: { sources: Load<Sources>; source: string | null; onChoose: (b: string) => void }) {
  return (
    <section aria-label="Branch to merge" className="flex min-h-0 min-w-0 flex-col">
      <h3 className="m-0 mb-2 text-[13px] font-semibold">Branch to merge</h3>
      {sources.state === 'loading' && (
        <p role="status" className={`m-0 ${muted}`}>
          Checking branches…
        </p>
      )}
      {sources.state === 'error' && (
        <p role="alert" className="m-0 break-words text-[13px] text-destructive">
          {sources.message}
        </p>
      )}
      {sources.state === 'ready' && (
        <>
          {sources.value.pullsError !== null && (
            <p role="alert" className="m-0 mb-2 break-words text-[13px] text-destructive">
              {sources.value.pullsError}
            </p>
          )}
          {sources.value.names.length === 0 ? (
            <p className={`m-0 ${muted}`}>{NO_SOURCES}</p>
          ) : (
            <ul role="listbox" aria-label="Branches to merge" className={listClass}>
              {sources.value.names.map((b) => {
                const pull = sources.value.pulls.get(b) ?? null;
                return (
                  <li key={b} role="presentation" className="flex items-center">
                    <button type="button" role="option" aria-selected={b === source} onClick={() => onChoose(b)} className={`${rowClass(b === source)} flex-1 break-all`}>
                      {b}
                    </button>
                    {pull !== null && (
                      <span className="shrink-0 pr-2 text-[12.5px]">
                        <PullLink pull={pull} />
                      </span>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function TargetPane({ branches, source, target, onChoose }: { branches: Load<string[]>; source: string; target: string | null; onChoose: (b: string) => void }) {
  const [filter, setFilter] = useState('');
  const matches = useMemo(() => {
    if (branches.state !== 'ready') return [];
    const q = filter.trim().toLowerCase();
    return branches.value.filter((b) => b !== source && (q === '' || b.toLowerCase().includes(q)));
  }, [branches, source, filter]);
  return (
    <section aria-label="Merge into" className="flex min-h-0 min-w-0 flex-col">
      <h3 className="m-0 mb-2 text-[13px] font-semibold">Merge into</h3>
      {branches.state === 'loading' && (
        <p role="status" className={`m-0 ${muted}`}>
          Loading branches…
        </p>
      )}
      {branches.state === 'error' && (
        <p role="alert" className="m-0 break-words text-[13px] text-destructive">
          {branches.message}
        </p>
      )}
      {branches.state === 'ready' && (
        <>
          <input type="text" aria-label="Filter branches" placeholder="Filter branches" value={filter} onChange={(e) => setFilter(e.target.value)} className={`${field} mb-2`} />
          <ul role="listbox" aria-label="Branches to merge into" className={listClass}>
            {matches.slice(0, BRANCH_RENDER_CAP).map((b) => (
              <li key={b} role="presentation">
                <button type="button" role="option" aria-selected={b === target} onClick={() => onChoose(b)} className={`${rowClass(b === target)} break-all`}>
                  {b}
                </button>
              </li>
            ))}
          </ul>
          {matches.length > BRANCH_RENDER_CAP && <p className={`m-0 mt-1 ${muted}`}>Showing the first {BRANCH_RENDER_CAP} of {matches.length}; type to narrow the list.</p>}
        </>
      )}
    </section>
  );
}

function Review({ compare, target }: { compare: Load<Comparison>; target: string }) {
  if (compare.state === 'loading')
    return (
      <p role="status" className={`m-0 ${muted}`}>
        Comparing…
      </p>
    );
  if (compare.state === 'error')
    return (
      <p role="alert" className="m-0 break-words text-[13px] text-destructive">
        {compare.message}
      </p>
    );
  const { files, aheadBy, behindBy, truncated } = compare.value;
  const adds = files.reduce((n, f) => n + f.additions, 0);
  const dels = files.reduce((n, f) => n + f.deletions, 0);
  if (aheadBy === 0 && files.length === 0 && !truncated)
    return (
      <p role="status" className="m-0 text-[13px]">
        {NO_CHANGES}
      </p>
    );
  return (
    <div className="flex min-h-0 flex-col text-[13px]">
      <p className="m-0 mb-1">
        {aheadBy} {aheadBy === 1 ? 'commit' : 'commits'} ahead, {behindBy} {behindBy === 1 ? 'commit' : 'commits'} behind {target}
      </p>
      <p className="m-0 mb-2">
        {files.length} {files.length === 1 ? 'file' : 'files'} changed, +{adds} −{dels}
      </p>
      {truncated && (
        <p role="note" className="m-0 mb-2 text-destructive">
          GitHub cut the file list off, so some changed files are not listed and the totals cover only those shown.
        </p>
      )}
      <ul aria-label="Changed files" className="m-0 max-h-[260px] list-none overflow-y-auto rounded-control border border-border p-0">
        {files.map((f, i) => (
          <li key={`${i}:${f.filename}`} className="border-b border-border px-2 py-1 last:border-b-0">
            <span className="break-all">{f.filename}</span>
            <span className={`block ${muted}`}>
              {describeFile(f)} · +{f.additions} −{f.deletions}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
