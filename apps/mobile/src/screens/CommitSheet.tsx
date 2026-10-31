/**
 * The mobile commit sheet (M-22), the counterpart of the desktop CommitDialog on the same words and rules: the title
 * "Commit {path}?", the rows File, Repository, Branch and Message (the fixed commitMessage(path), never editable), the
 * direct-commit warning on any branch that does not start with gonq/, and the actions stacked as 44px buttons: Commit
 * (primary, focused), "Commit to new branch…" (only off a gonq/ branch) and Cancel. The scrim, like Esc on desktop,
 * answers Cancel. Exports CommitSheet, which answers through onChoose.
 */
import { useEffect, useRef } from 'react';
import type { CommitChoice } from '@gonq/editor/controllers/github';
import { BRANCH_PREFIX } from '@gonq/editor/features/github/createBranch';
import { commitMessage } from '@gonq/editor/platform/github';

export function CommitSheet({ owner, repo, branch, path, onChoose }: { owner: string; repo: string; branch: string; path: string; onChoose: (choice: CommitChoice) => void }) {
  const commit = useRef<HTMLButtonElement>(null);
  useEffect(() => commit.current?.focus(), []);
  const direct = !branch.startsWith(BRANCH_PREFIX);
  return (
    <>
      <div className="m-scrim" data-testid="commit-scrim" onClick={() => onChoose('cancel')} />
      <section className="m-sheet m-choice" role="dialog" aria-modal="true" aria-labelledby="commit-title">
        <h2 id="commit-title" className="m-choice-title">
          Commit {path}?
        </h2>
        <dl className="m-commit-rows">
          <dt>File</dt>
          <dd>{path}</dd>
          <dt>Repository</dt>
          <dd>{`${owner}/${repo}`}</dd>
          <dt>Branch</dt>
          <dd>{branch}</dd>
          <dt>Message</dt>
          <dd>{commitMessage(path)}</dd>
        </dl>
        {direct && (
          <p role="note" className="m-commit-warning">
            This commits directly to {branch}. Branch protection and review rules are GitHub&rsquo;s; Gonq does not check them.
          </p>
        )}
        <button type="button" ref={commit} className="m-tap m-tap-primary m-block" onClick={() => onChoose('commit')}>
          Commit
        </button>
        {direct && (
          <button type="button" className="m-tap m-block m-outline" onClick={() => onChoose('new-branch')}>
            Commit to new branch…
          </button>
        )}
        <button type="button" className="m-tap m-block m-outline" onClick={() => onChoose('cancel')}>
          Cancel
        </button>
      </section>
    </>
  );
}
