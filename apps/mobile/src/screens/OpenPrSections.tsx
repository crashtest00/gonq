/**
 * The stacked sections of the mobile Open PR review screen (M-23), the counterpart of the panes in the desktop
 * OpenPrDialog with the same words and rules: SourceSection ("Branch to merge": the checked session branches, "#N"
 * links, "Checking branches…", NO_SOURCES), TargetSection ("Merge into": "Filter branches", "Loading branches…", the
 * first-100 cap note) and ReviewSection ("Review changes": the ahead/behind line, the totals, the truncation note, the
 * file list, "Comparing…", NO_CHANGES). Also exports PullLink (a 44px "#N" link opened through openLink), the Load
 * type and alreadyOpenMessage. Failures are not drawn here: the screen sends them to the global error banner.
 */
import { useMemo, useState } from 'react';
import { BRANCH_RENDER_CAP } from '@gonq/editor/controllers/repoTree';
import { openLink } from '@gonq/editor/editor/openLink';
import type { Comparison, OpenPull } from '@gonq/editor/platform/github';
import { NO_CHANGES, NO_SOURCES, describeFile } from '@gonq/editor/features/github/openPr';

export const alreadyOpenMessage = (n: number): string => `Pull request #${n} is already open for this branch`;

/** A request in flight, answered, or failed (the message went to the error banner). */
export type Load<T> = { state: 'loading' } | { state: 'error' } | { state: 'ready'; value: T };

export interface Sources {
  names: string[];
  pulls: Map<string, OpenPull | null>;
}

export function PullLink({ pull, children }: { pull: { number: number; url: string }; children?: string }) {
  return (
    <a
      href={pull.url}
      target="_blank"
      rel="noopener noreferrer"
      className="m-tap m-pr-link"
      onClick={(e) => {
        e.preventDefault();
        openLink(pull.url);
      }}
    >
      {children ?? `#${pull.number}`}
    </a>
  );
}

export function SourceSection({ sources, source, onChoose }: { sources: Load<Sources>; source: string | null; onChoose: (b: string) => void }) {
  return (
    <section aria-label="Branch to merge" className="m-pr-section">
      <h2>Branch to merge</h2>
      {sources.state === 'loading' && <p role="status">Checking branches…</p>}
      {sources.state === 'ready' &&
        (sources.value.names.length === 0 ? (
          <p className="m-pr-note">{NO_SOURCES}</p>
        ) : (
          <ul role="listbox" aria-label="Branches to merge" className="m-pr-list">
            {sources.value.names.map((b) => {
              const pull = sources.value.pulls.get(b) ?? null;
              return (
                <li key={b} role="presentation" className="m-pr-row">
                  <button type="button" role="option" aria-selected={b === source} className="m-tap m-pr-option" onClick={() => onChoose(b)}>
                    {b}
                  </button>
                  {pull !== null && <PullLink pull={pull} />}
                </li>
              );
            })}
          </ul>
        ))}
    </section>
  );
}

export function TargetSection({ branches, source, target, onChoose }: { branches: Load<string[]>; source: string; target: string | null; onChoose: (b: string) => void }) {
  const [filter, setFilter] = useState('');
  const matches = useMemo(() => {
    if (branches.state !== 'ready') return [];
    const q = filter.trim().toLowerCase();
    return branches.value.filter((b) => b !== source && (q === '' || b.toLowerCase().includes(q)));
  }, [branches, source, filter]);
  return (
    <section aria-label="Merge into" className="m-pr-section">
      <h2>Merge into</h2>
      {branches.state === 'loading' && <p role="status">Loading branches…</p>}
      {branches.state === 'ready' && (
        <>
          <input type="text" aria-label="Filter branches" placeholder="Filter branches" value={filter} onChange={(e) => setFilter(e.target.value)} className="m-tap m-pr-field" />
          <ul role="listbox" aria-label="Branches to merge into" className="m-pr-list">
            {matches.slice(0, BRANCH_RENDER_CAP).map((b) => (
              <li key={b} role="presentation" className="m-pr-row">
                <button type="button" role="option" aria-selected={b === target} className="m-tap m-pr-option" onClick={() => onChoose(b)}>
                  {b}
                </button>
              </li>
            ))}
          </ul>
          {matches.length > BRANCH_RENDER_CAP && (
            <p className="m-pr-note">
              Showing the first {BRANCH_RENDER_CAP} of {matches.length}; type to narrow the list.
            </p>
          )}
        </>
      )}
    </section>
  );
}

/** True when the comparison holds nothing to merge (no commits, no files, nothing cut off). */
export const isEmptyComparison = (c: Comparison): boolean => c.aheadBy === 0 && c.files.length === 0 && !c.truncated;

export function ReviewSection({ compare, target }: { compare: Load<Comparison>; target: string }) {
  return (
    <section aria-label="Review changes" className="m-pr-section">
      <h2>Review changes</h2>
      <ReviewBody compare={compare} target={target} />
    </section>
  );
}

function ReviewBody({ compare, target }: { compare: Load<Comparison>; target: string }) {
  if (compare.state === 'loading') return <p role="status">Comparing…</p>;
  if (compare.state === 'error') return null;
  const c = compare.value;
  if (isEmptyComparison(c)) return <p role="status">{NO_CHANGES}</p>;
  const adds = c.files.reduce((n, f) => n + f.additions, 0);
  const dels = c.files.reduce((n, f) => n + f.deletions, 0);
  return (
    <>
      <p>
        {c.aheadBy} {c.aheadBy === 1 ? 'commit' : 'commits'} ahead, {c.behindBy} {c.behindBy === 1 ? 'commit' : 'commits'} behind {target}
      </p>
      <p>
        {c.files.length} {c.files.length === 1 ? 'file' : 'files'} changed, +{adds} −{dels}
      </p>
      {c.truncated && (
        <p role="note" className="m-pr-warning">
          GitHub cut the file list off, so some changed files are not listed and the totals cover only those shown.
        </p>
      )}
      <ul aria-label="Changed files" className="m-pr-files">
        {c.files.map((f, i) => (
          <li key={`${i}:${f.filename}`}>
            <span className="m-pr-file">{f.filename}</span>
            <span className="m-pr-note">
              {describeFile(f)} · +{f.additions} −{f.deletions}
            </span>
          </li>
        ))}
      </ul>
    </>
  );
}
