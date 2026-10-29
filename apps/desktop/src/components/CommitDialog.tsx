/**
 * Confirmation dialog for committing a GitHub tab (File > Commit…, Ctrl+S): file path, owner/repo, the tab's
 * own branch and the fixed message, plus a warning when the branch is not a gonq/ branch. The Commit button
 * holds the focus (Enter confirms) and comes first in tab order, so Cancel is one Tab away; Esc cancels. On a
 * branch that is not a gonq/ branch a secondary "Commit to new branch…" button chooses 'new-branch'.
 */
import { useEffect, useRef } from 'react';
import { commitMessage } from '../platform/github';

export type CommitChoice = 'commit' | 'new-branch' | 'cancel';

/** Branches Gonq makes for itself start with this; any other branch gets the direct-commit warning. */
export const GONQ_BRANCH_PREFIX = 'gonq/';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function CommitDialog({ owner, repo, branch, path, onChoose }: { owner: string; repo: string; branch: string; path: string; onChoose: (choice: CommitChoice) => void }) {
  const commitRef = useRef<HTMLButtonElement>(null);
  useEffect(() => commitRef.current?.focus(), []);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="commit-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') onChoose('cancel');
        }}
        className="w-[420px] rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="commit-title" className="m-0 mb-3 text-[15px] font-semibold">
          Commit {path}?
        </h2>
        <dl className="m-0 mb-4 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[13px]">
          <dt className="text-muted-foreground">File</dt>
          <dd className="m-0 break-all">{path}</dd>
          <dt className="text-muted-foreground">Repository</dt>
          <dd className="m-0 break-all">{`${owner}/${repo}`}</dd>
          <dt className="text-muted-foreground">Branch</dt>
          <dd className="m-0 break-all">{branch}</dd>
          <dt className="text-muted-foreground">Message</dt>
          <dd className="m-0 break-all">{commitMessage(path)}</dd>
        </dl>
        {!branch.startsWith(GONQ_BRANCH_PREFIX) && (
          <p role="note" className="m-0 mb-4 text-[13px] text-destructive">
            This commits directly to {branch}. Branch protection and review rules are GitHub&rsquo;s; Gonq does not check them.
          </p>
        )}
        <div className="flex flex-row-reverse justify-start gap-2">
          <button type="button" ref={commitRef} onClick={() => onChoose('commit')} className={`${button} border-primary bg-primary text-primary-foreground`}>
            Commit
          </button>
          <button type="button" onClick={() => onChoose('cancel')} className={`${button} border-border bg-transparent`}>
            Cancel
          </button>
          {!branch.startsWith(GONQ_BRANCH_PREFIX) && (
            <button type="button" onClick={() => onChoose('new-branch')} className={`${button} mr-auto border-border bg-transparent`}>
              Commit to new branch…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
