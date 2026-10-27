/**
 * Edit > Settings… dialog: the comment author name (validated with platform/settings.ts) and the GitHub account
 * (who is signed in, Sign in / Sign out). Sign in and out are App's own actions, passed as props.
 */
import { useEffect, useRef, useState } from 'react';
import { signInStatus, type GitHubStatus } from '../platform/github';
import { DEFAULT_AUTHOR, MAX_AUTHOR_CHARS, authorNameProblem } from '../platform/settings';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring';

export function SettingsDialog({
  authorName,
  onSave,
  onSignIn,
  onSignOut,
  onClose,
}: {
  authorName: string;
  onSave: (name: string) => Promise<void>;
  /** Starts the GitHub sign-in. Its dialog is queued behind this one, so Sign In closes Settings (see below). */
  onSignIn: () => Promise<void>;
  onSignOut: () => Promise<void>;
  onClose: () => void;
}) {
  const [value, setValue] = useState(authorName);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  /** undefined while loading; null when GitHub is unavailable (the browser build). */
  const [github, setGithub] = useState<GitHubStatus | null | undefined>(undefined);
  const live = useRef(true);
  const refresh = async () => {
    let next: GitHubStatus | null;
    try {
      next = await signInStatus();
    } catch {
      next = null;
    }
    if (live.current) setGithub(next);
  };
  useEffect(() => {
    live.current = true;
    void refresh();
    return () => {
      live.current = false;
    };
  }, []);
  const githubAction = async (act: () => Promise<void>) => {
    await act();
    await refresh();
  };
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);

  const problem = authorNameProblem(value);
  const submit = async () => {
    if (problem !== null || saving) return;
    setSaving(true);
    try {
      await onSave(value);
      onClose();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <form
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
        }}
        className="w-[380px] max-w-[90vw] rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="settings-title" className="m-0 mb-3 text-[15px] font-semibold">
          Settings
        </h2>
        <label htmlFor="settings-author" className="mb-1 block text-[13px] font-semibold">
          Author name
        </label>
        <input
          id="settings-author"
          ref={input}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            setFailure(null);
          }}
          placeholder={DEFAULT_AUTHOR}
          maxLength={MAX_AUTHOR_CHARS + 20}
          aria-invalid={problem !== null}
          aria-describedby="settings-author-hint"
          className="h-8 w-full rounded-control border border-border bg-background px-2 text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
        <p id="settings-author-hint" role={problem || failure ? 'alert' : undefined} className={`m-0 mt-1 mb-5 text-[12px] ${problem || failure ? 'text-destructive' : 'text-muted-foreground'}`}>
          {problem ?? failure ?? `Written on the comments and replies you add.`}
        </p>
        <h3 className="m-0 mb-1 text-[13px] font-semibold">GitHub</h3>
        <div className="mb-5 flex items-center justify-between gap-3">
          <p id="settings-github-status" role="status" className="m-0 min-w-0 break-words text-[13px] text-muted-foreground">
            {github === undefined
              ? 'Checking…'
              : github === null
                ? 'GitHub sign-in needs the Gonq desktop app.'
                : github.signed_in
                  ? github.login !== null
                    ? `Signed in as ${github.login}.`
                    : 'Signed in.'
                  : 'Not signed in.'}
          </p>
          {github?.signed_in ? (
            <button type="button" onClick={() => void githubAction(onSignOut)} className={`${button} shrink-0 border-border bg-transparent`}>
              Sign Out
            </button>
          ) : (
            <button type="button" onClick={() => {
                void onSignIn();
                onClose();
              }} className={`${button} shrink-0 border-border bg-transparent`}>
              Sign In
            </button>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className={`${button} border-border bg-transparent`}>
            Cancel
          </button>
          <button
            type="submit"
            disabled={problem !== null || saving}
            className={`${button} border-primary bg-primary text-primary-foreground disabled:opacity-50`}
          >
            Save
          </button>
        </div>
      </form>
    </div>
  );
}
