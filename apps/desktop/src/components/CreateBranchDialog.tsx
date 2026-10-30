/**
 * The Create branch dialog: a fixed, uneditable "gonq/" prefix and a short name box, live validation with the
 * reason beside the field, a debounced advisory "already exists" check, and Create (one request in flight at a
 * time). With a `commit` (a dirty GitHub tab) it says the file will be committed too and does branch-and-commit.
 * The work is features/github/createBranch.ts; the dialog resolves with the outcome (or null when cancelled)
 * and reports a branch as soon as it exists through `onCreated`.
 */
import { useEffect, useRef, useState } from 'react';
import { branchExists } from '@gonq/editor/platform/github';
import { BRANCH_PREFIX, runCreateBranch, validateBranchName, type CreateOutcome, type PendingCommit } from '@gonq/editor/features/github/createBranch';

export const BRANCH_EXISTS_MESSAGE = 'That branch already exists';

/** How long typing pauses before the advisory existence check is made. */
const CHECK_DELAY_MS = 300;

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50';

export type CreateBranchResult = Extract<CreateOutcome, { status: 'done' }> | null;

export function CreateBranchDialog({
  owner,
  repo,
  source,
  commit,
  onCreated,
  onClose,
}: {
  owner: string;
  repo: string;
  /** The branch the new one is cut from. */
  source: string;
  commit: PendingCommit | null;
  onCreated: (branch: string) => void;
  onClose: (result: CreateBranchResult) => void;
}) {
  const [name, setName] = useState('');
  const [exists, setExists] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the branch exists but the commit failed: nothing more can be done here but read the message.
  const [left, setLeft] = useState(false);
  const inFlight = useRef(false);
  const invalid = validateBranchName(name);

  useEffect(() => {
    setExists(false);
    if (invalid !== null) return;
    let live = true;
    const timer = setTimeout(() => {
      branchExists(owner, repo, name).then(
        (yes) => live && setExists(yes),
        () => {}, // Advisory only: Create reports the real failure.
      );
    }, CHECK_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [owner, repo, name, invalid]);

  const create = async () => {
    if (inFlight.current || invalid !== null || left) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const out = await runCreateBranch({ owner, repo, source, name, commit, onCreated });
      switch (out.status) {
        case 'done':
          return onClose(out);
        case 'exists':
          return setExists(true);
        case 'conflict':
          return setError(`${commit?.path ?? 'The file'} changed on GitHub since you opened it, so no branch was created. Nothing was committed.`);
        case 'failed':
          return setError(out.message);
        case 'partial':
          setLeft(true);
          return setError(out.message);
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };

  const reason = name === '' ? null : invalid;
  const describedBy = reason !== null ? 'branch-reason' : exists ? 'branch-exists' : undefined;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-branch-title"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose(null);
        }}
        className="w-[420px] max-w-[calc(100vw-2rem)] rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="create-branch-title" className="m-0 mb-3 text-[15px] font-semibold">
          Create branch
        </h2>
        <p className="m-0 mb-3 break-all text-[13px] text-muted-foreground">From {source}</p>
        <div className="mb-1 flex min-w-0 items-center rounded-control border border-border bg-background text-[13px] focus-within:ring-2 focus-within:ring-ring">
          <span data-testid="branch-prefix" className="shrink-0 select-none pl-2 text-muted-foreground">
            {BRANCH_PREFIX}
          </span>
          <input
            autoFocus
            type="text"
            aria-label="Branch name"
            aria-invalid={reason !== null || exists}
            aria-describedby={describedBy}
            value={name}
            disabled={left}
            spellCheck={false}
            autoComplete="off"
            onChange={(e) => setName(e.target.value)}
            className="h-8 min-w-0 flex-1 border-0 bg-transparent pl-0 pr-2 text-foreground outline-none"
          />
        </div>
        <p id={reason !== null ? 'branch-reason' : 'branch-exists'} role="status" className="m-0 mb-3 min-h-[1.25rem] break-all text-[12.5px] text-destructive">
          {reason ?? (exists ? BRANCH_EXISTS_MESSAGE : '')}
        </p>
        {commit !== null && (
          <p className="m-0 mb-3 break-all text-[13px]">Creating this branch will also commit your changes in {commit.path} to it.</p>
        )}
        {error !== null && (
          <p role="alert" className="m-0 mb-3 break-words text-[13px] text-destructive">
            {error}
          </p>
        )}
        <div className="flex flex-row-reverse justify-start gap-2">
          <button
            type="submit"
            disabled={invalid !== null || exists || busy || left}
            className={`${button} border-primary bg-primary text-primary-foreground`}
          >
            Create
          </button>
          <button type="button" onClick={() => onClose(null)} className={`${button} border-border bg-transparent`}>
            {left ? 'Close' : 'Cancel'}
          </button>
        </div>
      </form>
    </div>
  );
}
