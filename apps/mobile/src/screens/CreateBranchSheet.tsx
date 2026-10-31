/**
 * The mobile Create branch sheet (M-20), the counterpart of the desktop CreateBranchDialog on the same shared logic
 * (features/github/createBranch.ts: BRANCH_PREFIX, validateBranchName, runCreateBranch): the fixed "gonq/" prefix in
 * front of the name box, "From <source>", the live reason (or "That branch already exists" from a debounced advisory
 * check or Create's own answer), the will-also-commit line for a dirty GitHub tab, the conflict and partial-failure
 * texts, Cancel and Create (Close after a partial failure), and one request in flight at a time. Exports
 * CreateBranchSheet, which resolves through onClose with the done outcome or null.
 */
import { useEffect, useRef, useState } from 'react';
import { BRANCH_PREFIX, runCreateBranch, validateBranchName, type PendingCommit } from '@gonq/editor/features/github/createBranch';
import { branchExists } from '@gonq/editor/platform/github';
import type { CreateBranchDone } from '@gonq/editor/controllers/github';

export const BRANCH_EXISTS_MESSAGE = 'That branch already exists';

/** How long typing pauses before the advisory existence check is made. */
const CHECK_DELAY_MS = 300;

export function CreateBranchSheet({
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
  onClose: (result: CreateBranchDone | null) => void;
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
    <>
      <div className="m-scrim" data-testid="create-branch-scrim" onClick={() => onClose(null)} />
      <form
        className="m-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-branch-title"
        onSubmit={(e) => {
          e.preventDefault();
          void create();
        }}
      >
        <h2 id="create-branch-title" className="m-choice-title">
          Create branch
        </h2>
        <p className="m-choice-body" style={{ overflowWrap: 'anywhere' }}>
          From {source}
        </p>
        <div className="m-tap m-field" style={{ display: 'flex', alignItems: 'stretch', width: '100%', margin: 0, gap: 0 }}>
          <span data-testid="branch-prefix" style={{ flexShrink: 0, display: 'flex', alignItems: 'center', color: 'var(--muted-foreground)', userSelect: 'none' }}>
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
            autoCapitalize="none"
            onChange={(e) => setName(e.target.value)}
            style={{ flex: 1, minWidth: 0, border: 0, background: 'transparent', color: 'inherit', font: 'inherit', outline: 'none', padding: 0, minHeight: 44 }}
          />
        </div>
        <p
          id={reason !== null ? 'branch-reason' : 'branch-exists'}
          role="status"
          style={{ margin: 0, minHeight: '1.25rem', overflowWrap: 'anywhere', color: 'var(--destructive)' }}
        >
          {reason ?? (exists ? BRANCH_EXISTS_MESSAGE : '')}
        </p>
        {commit !== null && <p style={{ margin: 0, overflowWrap: 'anywhere' }}>Creating this branch will also commit your changes in {commit.path} to it.</p>}
        {error !== null && (
          <p role="alert" style={{ margin: 0, overflowWrap: 'anywhere', color: 'var(--destructive)' }}>
            {error}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" className="m-tap m-outline" style={{ flex: 1 }} onClick={() => onClose(null)}>
            {left ? 'Close' : 'Cancel'}
          </button>
          <button type="submit" className="m-tap m-tap-primary" style={{ flex: 1 }} disabled={invalid !== null || exists || busy || left}>
            Create
          </button>
        </div>
      </form>
    </>
  );
}
