/**
 * INTERIM GitHub sign-in screen for the mobile walking skeleton (M-12); M-17 replaces it with the final design.
 * Plainly styled and driven by the shared useSignInController: idle Start, the user code with Copy code / Copy
 * address, Open github.com/login/device, waiting, denied and expired, then the signed-in login with Sign Out and
 * the session-only sentence. Strings and button names follow the desktop GitHubSignInPanel. Failures go to the
 * shell's error banner (useNotices), never to a per-screen failure state. Exports signInInterimScreen for the navigator.
 */
import { createElement, useEffect, useState } from 'react';
import { useSignInController } from '@gonq/editor/controllers/signIn';
import { signInStatus, signOut, toGitHubError, type GitHubStatus } from '@gonq/editor/platform/github';
import { useNotices } from '../shell/notices';
import { useNavigator, type Screen } from '../shell/StackNavigator';

const SESSION_ONLY = 'No keychain is available, so this sign-in lasts for this session only.';
const SIGNED_OUT: GitHubStatus = {
  signed_in: false,
  login: null,
  storage: null,
};

function Copyable({
  label,
  text,
  copy,
  onFail,
}: {
  label: string;
  text: string;
  copy: (t: string) => Promise<void>;
  onFail: (m: string) => void;
}) {
  const [state, setState] = useState<'copy' | 'copied' | 'failed'>('copy');
  return (
    <button
      type="button"
      className="m-tap"
      aria-label={label}
      style={{ border: '1px solid var(--border)' }}
      onClick={() =>
        copy(text).then(
          () => setState('copied'),
          (e) => {
            setState('failed');
            onFail(e instanceof Error ? e.message : String(e));
          },
        )
      }
    >
      {state === 'failed' ? 'Copy failed' : state === 'copied' ? 'Copied' : 'Copy'}
    </button>
  );
}

const box = {
  padding: 'var(--space-4)',
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--space-3)',
} as const;
const outline = { border: '1px solid var(--border)' } as const;

export function SignInInterim() {
  const { setError } = useNotices();
  const { pop } = useNavigator();
  const { step, start, stop, copy, openBrowser } = useSignInController();
  const [status, setStatus] = useState<GitHubStatus>(SIGNED_OUT);
  const [signedOutNow, setSignedOutNow] = useState(false);

  // Already signed in? A failure here (the web build) is not worth a banner: the banner is for pressing Start.
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

  useEffect(() => {
    if (step.name === 'failed') setError(step.message);
  }, [step, setError]);

  const current = signedOutNow ? SIGNED_OUT : step.name === 'approved' ? step.status : status;

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

  if (current.signed_in) {
    return (
      <div style={box}>
        <h2 style={{ margin: 0, fontSize: 17 }}>Signed in to GitHub</h2>
        <p role="status" style={{ margin: 0 }}>
          {current.login !== null ? `Signed in as ${current.login}.` : 'Signed in.'}
        </p>
        {current.storage === 'session_only' && <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>{SESSION_ONLY}</p>}
        <button type="button" className="m-tap" style={outline} onClick={() => void doSignOut()}>
          Sign Out
        </button>
      </div>
    );
  }

  if (step.name === 'starting') {
    return (
      <div style={box}>
        <p role="status" style={{ margin: 0, color: 'var(--muted-foreground)' }}>
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
        <p style={{ margin: 0 }}>Enter this code on GitHub:</p>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            ...outline,
            padding: 'var(--space-2) var(--space-3)',
            borderRadius: 'var(--radius-control)',
          }}
        >
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
          <Copyable label="Copy code" text={step.start.user_code} copy={copy} onFail={setError} />
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 'var(--space-3)',
            color: 'var(--muted-foreground)',
          }}
        >
          <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{step.start.verification_uri}</span>
          <Copyable label="Copy address" text={step.start.verification_uri} copy={copy} onFail={setError} />
        </div>
        {step.openFailed !== null && (
          <p role="alert" style={{ margin: 0, color: 'var(--destructive)' }}>
            Could not open the browser ({step.openFailed}). Open the address above yourself and type the code.
          </p>
        )}
        <p role="status" style={{ margin: 0, color: 'var(--muted-foreground)' }}>
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
        : null;
  return (
    <div style={box}>
      {problem !== null && (
        <p role="alert" style={{ margin: 0, color: 'var(--destructive)' }}>
          {problem}
        </p>
      )}
      <p style={{ margin: 0, color: 'var(--muted-foreground)' }}>
        Gonq shows a code to type on github.com. Your password and token never pass through this window.
      </p>
      <button type="button" className="m-tap m-tap-primary" onClick={begin}>
        {step.name === 'idle' || step.name === 'approved' ? 'Start' : 'Try again'}
      </button>
      <button type="button" className="m-tap" style={outline} onClick={cancel}>
        Cancel
      </button>
    </div>
  );
}

export const signInInterimScreen: Screen = {
  key: 'sign-in-interim',
  title: 'Sign in to GitHub',
  render: () => createElement(SignInInterim),
};
