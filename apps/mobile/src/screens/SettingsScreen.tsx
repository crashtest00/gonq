/**
 * The mobile Settings screen (M-29), as desktop's SettingsDialog: only the comment author name (validated by
 * authorNameProblem; Save disabled while invalid; a backend failure shows in the hint line) and the GitHub account
 * row (Checking…, Not signed in. + Sign In, Signed in as <login>. + Sign Out). No theme row, no SSH keys, no pane
 * widths. Exports settingsScreen for the navigator. Sign In pushes the M-17 sign-in screen.
 */
import { createElement, useEffect, useRef, useState, type CSSProperties } from 'react';
import { signInStatus, signOut, toGitHubError, type GitHubStatus } from '@gonq/editor/platform/github';
import { DEFAULT_AUTHOR, MAX_AUTHOR_CHARS, authorNameProblem, getAuthorName, setAuthorName } from '@gonq/editor/platform/settings';
import { useNotices } from '../shell/notices';
import { useNavigator, type Screen } from '../shell/StackNavigator';
import { githubSignInScreen } from './GitHubSignIn';

export const GITHUB_ROW_UNAVAILABLE = 'GitHub sign-in needs the Gonq app.';

const box: CSSProperties = { padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' };
const outline: CSSProperties = { border: '1px solid var(--border)' };
const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' };

export function SettingsScreen() {
  const { pop, push } = useNavigator();
  const { setError } = useNotices();
  const [value, setValue] = useState(DEFAULT_AUTHOR);
  const [loaded, setLoaded] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  /** undefined while loading; null when GitHub is unavailable (the web build). */
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
    void getAuthorName().then((n) => {
      if (!live.current) return;
      setValue(n);
      setLoaded(true);
    });
    return () => {
      live.current = false;
    };
  }, []);

  const problem = authorNameProblem(value);
  const submit = async () => {
    if (problem !== null || saving || !loaded) return;
    setSaving(true);
    try {
      await setAuthorName(value);
      pop();
    } catch (e) {
      setFailure(e instanceof Error ? e.message : String(e));
      setSaving(false);
    }
  };
  const doSignOut = async () => {
    try {
      await signOut();
    } catch (e) {
      setError(toGitHubError(e).message);
    }
    await refresh();
  };

  return (
    <form
      aria-label="Settings"
      style={box}
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="settings-author" style={{ fontWeight: 600 }}>
        Author name
      </label>
      <input
        id="settings-author"
        className="m-tap"
        style={{ ...outline, background: 'var(--background)', justifyContent: 'flex-start', width: '100%', boxSizing: 'border-box' }}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setFailure(null);
        }}
        placeholder={DEFAULT_AUTHOR}
        maxLength={MAX_AUTHOR_CHARS + 20}
        aria-invalid={problem !== null}
        aria-describedby="settings-author-hint"
      />
      <p
        id="settings-author-hint"
        role={problem || failure ? 'alert' : undefined}
        style={{ margin: 0, fontSize: 12, color: problem || failure ? 'var(--destructive)' : 'var(--muted-foreground)' }}
      >
        {problem ?? failure ?? 'Written on the comments and replies you add.'}
      </p>
      <h3 style={{ margin: 'var(--space-4) 0 0', fontSize: 15 }}>GitHub</h3>
      <div style={row}>
        <p id="settings-github-status" role="status" style={{ margin: 0, minWidth: 0, overflowWrap: 'anywhere', color: 'var(--muted-foreground)' }}>
          {github === undefined
            ? 'Checking…'
            : github === null
              ? GITHUB_ROW_UNAVAILABLE
              : github.signed_in
                ? github.login !== null
                  ? `Signed in as ${github.login}.`
                  : 'Signed in.'
                : 'Not signed in.'}
        </p>
        {github?.signed_in ? (
          <button type="button" className="m-tap" style={{ ...outline, flex: 'none' }} onClick={() => void doSignOut()}>
            Sign Out
          </button>
        ) : (
          <button type="button" className="m-tap" style={{ ...outline, flex: 'none' }} onClick={() => push(githubSignInScreen)}>
            Sign In
          </button>
        )}
      </div>
      <div style={{ ...row, justifyContent: 'flex-end', marginTop: 'var(--space-4)' }}>
        <button type="button" className="m-tap" style={outline} onClick={pop}>
          Cancel
        </button>
        <button type="submit" className="m-tap m-tap-primary" disabled={problem !== null || saving || !loaded}>
          Save
        </button>
      </div>
    </form>
  );
}

export const settingsScreen: Screen = { key: 'settings', title: 'Settings', render: () => createElement(SettingsScreen) };
