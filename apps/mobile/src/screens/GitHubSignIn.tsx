/**
 * The mobile GitHub sign-in screen (M-17), on the shared useSignInController: idle Start, starting, waiting (code,
 * Copy code, address with Copy address, Open github.com/login/device), approved (Done, session-only notice), denied,
 * expired and failed (Try again), and the signed-in @login view. Strings and roles follow the desktop
 * GitHubSignInPanel verbatim; only the layout is mobile. Exports githubSignInScreen for the navigator and
 * SignInBridge, which registers the screen as the platform sign-in handler so ensureSignedIn can send the user here.
 */
import { createElement, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useSignInController } from '@gonq/editor/controllers/signIn';
import { setSignInHandler, signInStatus, signOut, toGitHubError, type GitHubStatus } from '@gonq/editor/platform/github';
import { useNotices } from '../shell/notices';
import { useNavigator, type Screen } from '../shell/StackNavigator';

const SESSION_ONLY = 'No keychain is available, so this sign-in lasts for this session only.';
const SIGNED_OUT: GitHubStatus = { signed_in: false, login: null, storage: null };

const box: CSSProperties = { padding: 'var(--space-4)', display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' };
const outline: CSSProperties = { border: '1px solid var(--border)' };
const text: CSSProperties = { margin: 0 };
const muted: CSSProperties = { margin: 0, color: 'var(--muted-foreground)' };
const alertText: CSSProperties = { margin: 0, color: 'var(--destructive)' };
const row: CSSProperties = { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' };

function Copyable({ label, value, copy }: { label: string; value: string; copy: (t: string) => Promise<void> }) {
  const [state, setState] = useState<'copy' | 'copied' | 'failed'>('copy');
  return (
    <button
      type="button"
      className="m-tap"
      aria-label={label}
      style={outline}
      onClick={() =>
        copy(value).then(
          () => setState('copied'),
          () => setState('failed'),
        )
      }
    >
      {state === 'failed' ? 'Copy failed' : state === 'copied' ? 'Copied' : 'Copy'}
    </button>
  );
}

export function GitHubSignIn() {
  const { setError } = useNotices();
  const { pop } = useNavigator();
  const { step, start, stop, copy, openBrowser } = useSignInController();
  const [status, setStatus] = useState<GitHubStatus>(SIGNED_OUT);
  const [signedOutNow, setSignedOutNow] = useState(false);

  // Already signed in? A failure here (the web build) is not worth a banner: the screen still offers Start.
  useEffect(() => {
    let live = true;
    signInStatus().then(
      (s) => live && setStatus(s),
      () => {},
    );
    return () => {
      live = false;
    };
  }, []);

  const cancel = () => {
    stop();
    pop();
  };
  const begin = () => {
    setError(null);
    setSignedOutNow(false);
    void start();
  };
  const doSignOut = async () => {
    try {
      await signOut();
      setStatus(SIGNED_OUT);
      setSignedOutNow(true);
    } catch (e) {
      setError(toGitHubError(e).message);
    }
  };

  const heading = <h2 style={{ margin: 0, fontSize: 17 }}>Signed in to GitHub</h2>;

  if (step.name === 'approved') {
    return (
      <div style={box}>
        {heading}
        <p role="status" style={text}>
          Approved. {step.status.login !== null ? `Signed in as ${step.status.login}.` : 'You are signed in.'}
        </p>
        {step.status.storage === 'session_only' && <p style={muted}>{SESSION_ONLY}</p>}
        <button type="button" className="m-tap m-tap-primary" onClick={pop}>
          Done
        </button>
      </div>
    );
  }

  if (step.name === 'idle' && status.signed_in && !signedOutNow) {
    return (
      <div style={box}>
        {heading}
        <p style={text}>{status.login !== null ? `@${status.login}` : 'You are signed in.'}</p>
        {status.storage === 'session_only' && <p style={muted}>{SESSION_ONLY}</p>}
        <button type="button" className="m-tap m-tap-primary" onClick={pop}>
          Done
        </button>
        <button type="button" className="m-tap" style={outline} onClick={() => void doSignOut()}>
          Sign Out
        </button>
      </div>
    );
  }

  if (step.name === 'starting') {
    return (
      <div style={box}>
        <p role="status" style={muted}>
          Asking GitHub for a code…
        </p>
        <button type="button" className="m-tap" style={outline} onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  if (step.name === 'waiting') {
    return (
      <div style={box}>
        <p style={text}>Enter this code on GitHub:</p>
        <div style={{ ...row, ...outline, padding: 'var(--space-2) var(--space-3)', borderRadius: 'var(--radius-control)' }}>
          <code
            aria-label="User code"
            style={{
              fontFamily: 'var(--font-mono, monospace)',
              fontSize: 26,
              fontWeight: 600,
              letterSpacing: '.1em',
              userSelect: 'all',
              overflowWrap: 'anywhere',
            }}
          >
            {step.start.user_code}
          </code>
          <Copyable label="Copy code" value={step.start.user_code} copy={copy} />
        </div>
        <div style={{ ...row, color: 'var(--muted-foreground)' }}>
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{step.start.verification_uri}</span>
          <Copyable label="Copy address" value={step.start.verification_uri} copy={copy} />
        </div>
        {step.openFailed !== null && (
          <p role="alert" style={alertText}>
            Could not open the browser ({step.openFailed}). Open the address above yourself and type the code.
          </p>
        )}
        <p role="status" style={muted}>
          Waiting for approval on github.com…
        </p>
        <button type="button" className="m-tap m-tap-primary" onClick={() => void openBrowser()}>
          Open github.com/login/device
        </button>
        <button type="button" className="m-tap" style={outline} onClick={cancel}>
          Cancel
        </button>
      </div>
    );
  }

  const problem =
    step.name === 'denied'
      ? 'Sign-in was denied on github.com.'
      : step.name === 'expired'
        ? 'The code expired before it was approved.'
        : step.name === 'failed'
          ? step.message
          : null;
  return (
    <div style={box}>
      {problem !== null && (
        <p role="alert" style={alertText}>
          {problem}
        </p>
      )}
      <p style={muted}>Gonq shows a code to type on github.com. Your password and token never pass through this window.</p>
      <button type="button" className="m-tap m-tap-primary" onClick={begin}>
        {step.name === 'idle' ? 'Start' : 'Try again'}
      </button>
      <button type="button" className="m-tap" style={outline} onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}

export const githubSignInScreen: Screen = {
  key: 'github-sign-in',
  title: 'Sign in to GitHub',
  render: () => createElement(GitHubSignIn),
};

/**
 * Registers the sign-in screen as the platform sign-in handler: ensureSignedIn pushes it and resolves, once the
 * screen has left the stack (Done, Cancel or Back), with whether a token exists. Renders nothing.
 */
export function SignInBridge() {
  const nav = useNavigator();
  const navRef = useRef(nav);
  navRef.current = nav;
  const pending = useRef<Promise<boolean> | null>(null);
  const settle = useRef<(() => void) | null>(null);
  const open = nav.stack.some((s) => s.key === githubSignInScreen.key);

  useEffect(
    () =>
      setSignInHandler(() => {
        if (pending.current !== null) return pending.current;
        const asked = new Promise<boolean>((resolve) => {
          settle.current = () => {
            settle.current = null;
            signInStatus().then(
              (s) => resolve(s.signed_in),
              () => resolve(false),
            );
          };
        });
        pending.current = asked;
        void asked.finally(() => {
          pending.current = null;
        });
        navRef.current.push(githubSignInScreen);
        return asked;
      }),
    [],
  );

  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) wasOpen.current = true;
    else if (wasOpen.current) {
      wasOpen.current = false;
      settle.current?.();
    }
  }, [open]);
  return null;
}
