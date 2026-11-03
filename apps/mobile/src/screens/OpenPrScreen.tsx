/**
 * The mobile Open PR flow (M-23), the counterpart of the desktop OpenPrDialog on the same words and rules, as one pushed
 * screen whose top-bar title follows its three phases: "Open pull request" (the review screen: Repository, Branch to
 * merge, Merge into and Review changes stacked, with Cancel and Open PR), the same title for the details screen
 * ("<repo>: <source> into <target>", Title, Description from prDefaults.ts, buttons Back, Cancel, Open PR; Back discards
 * the edits) and "Pull request opened" (the link, Open in browser, Close, the label note). Failures go to the global
 * error banner. Exports openPrScreen (pushed by GithubProvider for the controller's openPr dialog) and OPEN_PR_SCREEN_KEY.
 */
import { createElement, useEffect, useMemo, useRef, useState } from 'react';
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
import { repoKey, repoOptions, sameRepo, sourceCandidates, type RepoRef } from '@gonq/editor/features/github/openPr';
import { defaultPrBody, defaultPrTitle } from '@gonq/editor/features/github/prDefaults';
import type { SessionBranch } from '@gonq/editor/features/github/sessionBranches';
import { useBackHandler } from '../shell/back';
import { useNotices } from '../shell/notices';
import { useNavigator, type Screen } from '../shell/StackNavigator';
import { PullLink, ReviewSection, SourceSection, TargetSection, alreadyOpenMessage, isEmptyComparison, type Load, type Sources } from './OpenPrSections';

export const OPEN_PR_SCREEN_KEY = 'open-pr';

export interface OpenedPr {
  owner: string;
  repo: string;
  branch: string;
  pull: CreatedPull;
}

export interface OpenPrArgs {
  /** The repository the selector starts on (the navigator's). */
  preferred: RepoRef | null;
  tabBranches: SessionBranch[];
  sessionBranches: SessionBranch[];
  onOpened: (opened: OpenedPr) => void;
}

const message = (e: unknown): string => toGitHubError(e).message;
const TITLE = 'Open pull request';
const DONE_TITLE = 'Pull request opened';

export function OpenPrFlow({ args }: { args: OpenPrArgs }) {
  const { setError } = useNotices();
  const nav = useNavigator();
  const navRef = useRef(nav);
  navRef.current = nav;
  const { preferred, tabBranches, sessionBranches } = args;
  const repos = useMemo(() => repoOptions(preferred, tabBranches, sessionBranches), [preferred, tabBranches, sessionBranches]);
  const [repo, setRepo] = useState<RepoRef | null>(repos[0] ?? null);
  const [source, setSource] = useState<string | null>(null);
  const [target, setTarget] = useState<string | null>(null);
  const [phase, setPhase] = useState<'review' | 'details' | 'done'>('review');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [created, setCreated] = useState<CreatedPull | null>(null);
  const inFlight = useRef(false);
  const onOpened = useRef(args.onOpened);
  onOpened.current = args.onOpened;
  const fail = (e: unknown) => setError(message(e));
  const failRef = useRef(fail);
  failRef.current = fail;

  // The top bar names the phase; replacing the screen keeps this component (and its state) mounted.
  useEffect(() => {
    const want = phase === 'done' ? DONE_TITLE : TITLE;
    if (navRef.current.top.key === OPEN_PR_SCREEN_KEY && navRef.current.top.title !== want) navRef.current.replace({ ...navRef.current.top, title: want });
  }, [phase]);

  const repoId = repo === null ? null : repoKey(repo);

  // Branch to merge: the candidates, each checked to still exist, and which have an open pull request.
  const [sources, setSources] = useState<Load<Sources>>({ state: 'loading' });
  useEffect(() => {
    setSource(null);
    setTarget(null);
    setPhase('review');
    if (repo === null) return;
    let live = true;
    setSources({ state: 'loading' });
    (async () => {
      const wanted = sourceCandidates(repo, sessionBranches, tabBranches);
      const present = new Set(await branchesExist(repo.owner, repo.repo, wanted));
      const names = wanted.filter((b) => present.has(b));
      let pulls = new Map<string, OpenPull | null>();
      try {
        pulls = await openPullsForBranches(repo.owner, repo.repo, names);
      } catch (e) {
        // The branches are still listed, without "#N" marks.
        if (live) failRef.current(e);
      }
      if (live) setSources({ state: 'ready', value: { names, pulls } });
    })().catch((e) => {
      if (!live) return;
      setSources({ state: 'error' });
      failRef.current(e);
    });
    return () => {
      live = false;
    };
  }, [repoId]);

  // Merge into: every branch of the repository, fetched when a source is first chosen.
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
    })().catch((e) => {
      if (!live) return;
      setBranches({ state: 'error' });
      failRef.current(e);
    });
    return () => {
      live = false;
    };
  }, [repoId, wantBranches]);

  const sourcePull = source !== null && sources.state === 'ready' ? (sources.value.pulls.get(source) ?? null) : null;

  // Review changes: the comparison, refreshed whenever either branch changes.
  const [compare, setCompare] = useState<Load<Comparison>>({ state: 'loading' });
  useEffect(() => {
    if (repo === null || source === null || target === null || sourcePull !== null) return;
    let live = true;
    setCompare({ state: 'loading' });
    compareBranches(repo.owner, repo.repo, target, source).then(
      (value) => live && setCompare({ state: 'ready', value }),
      (e) => {
        if (!live) return;
        setCompare({ state: 'error' });
        failRef.current(e);
      },
    );
    return () => {
      live = false;
    };
  }, [repoId, source, target, sourcePull !== null]);

  const changeRepo = (key: string) => {
    const next = repos.find((r) => repoKey(r) === key) ?? null;
    if (next !== null && repo !== null && sameRepo(next, repo)) return;
    setError(null);
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
    setPhase('details');
  };

  const open = async () => {
    if (inFlight.current || repo === null || source === null || target === null) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const pull = await createPull({ owner: repo.owner, repo: repo.repo, title, body, head: source, base: target });
      setCreated(pull);
      setPhase('done');
      onOpened.current({ owner: repo.owner, repo: repo.repo, branch: source, pull });
    } catch (e) {
      fail(e);
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const close = () => nav.pop();
  // The Android Back key steps back one screen: details to review (the Back button, not while opening), review and done close the flow.
  useBackHandler(
    true,
    () => {
      if (phase !== 'details') return close();
      if (busy) return;
      setError(null);
      setPhase('review');
    },
    'screen',
  );
  const canOpen = sourcePull === null && source !== null && target !== null && compare.state === 'ready' && !isEmptyComparison(compare.value);

  if (phase === 'done' && created !== null)
    return (
      <div className="m-pr">
        <div className="m-pr-body">
          <p>
            Pull request <PullLink pull={created} /> was opened for {source}.
          </p>
          {created.labelWarning !== undefined && (
            <p role="note" className="m-pr-note">
              Pull request created, but its label could not be added: {created.labelWarning}
            </p>
          )}
        </div>
        <div className="m-pr-foot">
          <button type="button" className="m-tap m-outline" onClick={close}>
            Close
          </button>
          <button type="button" className="m-tap m-tap-primary" onClick={() => openLink(created.url)}>
            Open in browser
          </button>
        </div>
      </div>
    );

  if (phase === 'details')
    return (
      <form
        className="m-pr"
        onSubmit={(e) => {
          e.preventDefault();
          void open();
        }}
      >
        <div className="m-pr-body">
          <p className="m-pr-note m-pr-heading">
            {repoId}: {source} into {target}
          </p>
          <label className="m-pr-label">
            <span>Title</span>
            <input type="text" value={title} onChange={(e) => setTitle(e.target.value)} className="m-tap m-pr-field" />
          </label>
          <label className="m-pr-label">
            <span>Description</span>
            <textarea value={body} onChange={(e) => setBody(e.target.value)} rows={14} className="m-pr-area" />
          </label>
        </div>
        <div className="m-pr-foot">
          <button
            type="button"
            className="m-tap m-outline"
            disabled={busy}
            onClick={() => {
              setError(null);
              setPhase('review');
            }}
          >
            Back
          </button>
          <button type="button" className="m-tap m-outline" onClick={close}>
            Cancel
          </button>
          <button type="submit" className="m-tap m-tap-primary" disabled={busy}>
            Open PR
          </button>
        </div>
      </form>
    );

  return (
    <div className="m-pr">
      <div className="m-pr-body">
        <label className="m-pr-label">
          <span>Repository</span>
          <select aria-label="Repository" value={repoId ?? ''} onChange={(e) => changeRepo(e.target.value)} className="m-tap m-pr-field">
            {repos.map((r) => (
              <option key={repoKey(r)} value={repoKey(r)}>
                {repoKey(r)}
              </option>
            ))}
          </select>
        </label>
        <SourceSection
          sources={sources}
          source={source}
          onChoose={(b) => {
            setSource(b);
            setTarget(null);
          }}
        />
        {source !== null && <TargetSection branches={branches} source={source} target={target} onChoose={setTarget} />}
        {source !== null && sourcePull !== null && (
          <section aria-label="Review changes" className="m-pr-section">
            <h2>Review changes</h2>
            <p role="status">
              {alreadyOpenMessage(sourcePull.number)}: <PullLink pull={sourcePull} />
            </p>
          </section>
        )}
        {source !== null && sourcePull === null && target !== null && <ReviewSection compare={compare} target={target} />}
      </div>
      <div className="m-pr-foot">
        <button type="button" className="m-tap m-outline" onClick={close}>
          Cancel
        </button>
        {sourcePull === null && (
          <button type="button" className="m-tap m-tap-primary" disabled={!canOpen} onClick={toDetails}>
            Open PR
          </button>
        )}
      </div>
    </div>
  );
}

/** The Open PR screen for `args`; the shell pushes it and learns it was closed when it leaves the stack. */
export const openPrScreen = (args: OpenPrArgs): Screen => ({ key: OPEN_PR_SCREEN_KEY, title: TITLE, render: () => createElement(OpenPrFlow, { args }) });
