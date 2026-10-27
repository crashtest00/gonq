/**
 * The GitHub device-flow sign-in dialog (copyable code, open github.com/login/device, waiting/approved/denied/
 * expired states, signed-in view with Sign out). App.tsx registers it as the ensureSignedIn handler.
 */
import { useEffect, useRef, useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { copyText } from '../platform/clipboard';
import { openExternal } from '../platform/external';
import {
  pollSignIn,
  signOut,
  startSignIn,
  toGitHubError,
  type DeviceStart,
  type GitHubStatus,
} from '../platform/github';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const primary = `${button} border-primary bg-primary text-primary-foreground`;
const plain = `${button} border-border bg-transparent`;

export const DEVICE_URL = 'https://github.com/login/device';

type Step =
  | { name: 'idle'; note: string | null }
  | { name: 'starting' }
  | { name: 'waiting'; start: DeviceStart; openFailed: string | null }
  | { name: 'approved'; status: GitHubStatus }
  | { name: 'denied' }
  | { name: 'expired' }
  | { name: 'failed'; message: string }
  | { name: 'signed_in'; status: GitHubStatus };

const SESSION_ONLY = 'No keychain is available, so this sign-in lasts for this session only.';

function Copyable({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        copyText(text).then(
          () => {
            setFailed(false);
            setCopied(true);
          },
          () => setFailed(true),
        );
      }}
      className="inline-flex h-7 shrink-0 cursor-pointer items-center gap-1 rounded-control border border-border bg-transparent px-2 text-[12px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {copied ? <Check size={14} aria-hidden /> : <Copy size={14} aria-hidden />}
      {failed ? 'Copy failed' : copied ? 'Copied' : 'Copy'}
    </button>
  );
}

/**
 * Opened from Settings > GitHub > Sign In: shows the device code, waits for approval on github.com, or (already signed in)
 * the login with a Sign out button. Neither the token nor the device code ever reaches here.
 * `onClose` says whether the user is signed in on the way out.
 */
export function GitHubSignInDialog({
  status,
  onClose,
}: {
  status: GitHubStatus;
  onClose: (signedIn: boolean) => void;
}) {
  const [step, setStep] = useState<Step>(
    status.signed_in ? { name: 'signed_in', status } : { name: 'idle', note: null },
  );
  const live = useRef(true);
  /** Bumped by every Start and by Cancel/unmount, so a late reply from an abandoned sign-in is ignored. */
  const run = useRef(0);
  const polling = useRef(false);

  /** Stops the sign-in being polled: Rust ends it when a sign out arrives (nothing is stored yet). */
  const stopPolling = () => {
    run.current++;
    if (!polling.current) return;
    polling.current = false;
    signOut().catch(() => {});
  };

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      stopPolling();
    };
  }, []);

  const start = async () => {
    const mine = ++run.current;
    setStep({ name: 'starting' });
    let begun: DeviceStart;
    try {
      begun = await startSignIn();
    } catch (e) {
      if (live.current && run.current === mine) setStep({ name: 'failed', message: toGitHubError(e).message });
      return;
    }
    if (!live.current || run.current !== mine) return;
    setStep({ name: 'waiting', start: begun, openFailed: null });
    polling.current = true;
    try {
      const done = await pollSignIn();
      if (!live.current || run.current !== mine) return;
      polling.current = false;
      setStep({ name: 'approved', status: done });
    } catch (e) {
      if (!live.current || run.current !== mine) return;
      polling.current = false;
      const err = toGitHubError(e);
      if (err.kind === 'denied') setStep({ name: 'denied' });
      else if (err.kind === 'expired') setStep({ name: 'expired' });
      else setStep({ name: 'failed', message: err.message });
    }
  };

  const cancel = () => {
    stopPolling();
    onClose(step.name === 'approved' || step.name === 'signed_in');
  };

  const openBrowser = async () => {
    try {
      await openExternal(DEVICE_URL);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStep((s) => (s.name === 'waiting' ? { ...s, openFailed: message } : s));
    }
  };

  const doSignOut = async () => {
    try {
      await signOut();
      if (live.current) setStep({ name: 'idle', note: 'Signed out of GitHub.' });
    } catch (e) {
      if (live.current) setStep({ name: 'failed', message: toGitHubError(e).message });
    }
  };

  let title = 'Sign in to GitHub';
  let body;
  switch (step.name) {
    case 'idle':
    case 'denied':
    case 'expired':
    case 'failed': {
      const problem =
        step.name === 'denied'
          ? 'Sign-in was denied on github.com.'
          : step.name === 'expired'
            ? 'The code expired before it was approved.'
            : step.name === 'failed'
              ? step.message
              : null;
      body = (
        <>
          {problem !== null && (
            <p role="alert" className="m-0 mb-3 text-[13px] text-destructive">
              {problem}
            </p>
          )}
          {step.name === 'idle' && step.note !== null && (
            <p role="status" className="m-0 mb-3 text-[13px] text-muted-foreground">
              {step.note}
            </p>
          )}
          <p className="m-0 mb-4 text-[13px] text-muted-foreground">
            Gonq shows a code to type on github.com. Your password and token never pass through this window.
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={plain} onClick={cancel}>
              Cancel
            </button>
            <button type="button" className={primary} onClick={() => void start()}>
              {step.name === 'idle' ? 'Start' : 'Try again'}
            </button>
          </div>
        </>
      );
      break;
    }
    case 'starting':
      body = (
        <>
          <p role="status" className="m-0 flex items-center gap-2 py-6 text-[13px] text-muted-foreground">
            <Loader2 size={16} aria-hidden className="animate-spin" />
            Asking GitHub for a code…
          </p>
          <div className="flex justify-end">
            <button type="button" className={plain} onClick={cancel}>
              Cancel
            </button>
          </div>
        </>
      );
      break;
    case 'waiting':
      body = (
        <>
          <p className="m-0 mb-2 text-[13px]">Enter this code on GitHub:</p>
          <div className="mb-3 flex items-center justify-between gap-3 rounded-control border border-border bg-background px-3 py-2">
            <code aria-label="User code" className="select-all break-all font-mono text-[26px] font-semibold tracking-widest">
              {step.start.user_code}
            </code>
            <Copyable label="Copy code" text={step.start.user_code} />
          </div>
          <div className="mb-3 flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
            <span className="min-w-0 select-all break-all">{step.start.verification_uri}</span>
            <Copyable label="Copy address" text={step.start.verification_uri} />
          </div>
          {step.openFailed !== null && (
            <p role="alert" className="m-0 mb-3 text-[13px] text-destructive">
              Could not open the browser ({step.openFailed}). Open the address above yourself and type the code.
            </p>
          )}
          <p role="status" className="m-0 mb-4 flex items-center gap-2 text-[13px] text-muted-foreground">
            <Loader2 size={16} aria-hidden className="animate-spin" />
            Waiting for approval on github.com…
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className={plain} onClick={cancel}>
              Cancel
            </button>
            <button type="button" className={primary} onClick={() => void openBrowser()}>
              Open github.com/login/device
            </button>
          </div>
        </>
      );
      break;
    case 'approved':
      title = 'Signed in to GitHub';
      body = (
        <>
          <p role="status" className="m-0 mb-2 text-[13px]">
            Approved. {step.status.login !== null ? `Signed in as ${step.status.login}.` : 'You are signed in.'}
          </p>
          {step.status.storage === 'session_only' && (
            <p className="m-0 mb-2 text-[13px] text-muted-foreground">{SESSION_ONLY}</p>
          )}
          <div className="mt-4 flex justify-end">
            <button type="button" className={primary} autoFocus onClick={() => onClose(true)}>
              Done
            </button>
          </div>
        </>
      );
      break;
    case 'signed_in':
      title = 'GitHub';
      body = (
        <>
          <p role="status" className="m-0 mb-2 text-[13px]">
            {step.status.login !== null ? `Signed in as ${step.status.login}.` : 'You are signed in.'}
          </p>
          {step.status.storage === 'session_only' && (
            <p className="m-0 mb-2 text-[13px] text-muted-foreground">{SESSION_ONLY}</p>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" className={plain} onClick={() => void doSignOut()}>
              Sign out
            </button>
            <button type="button" className={primary} autoFocus onClick={() => onClose(true)}>
              Close
            </button>
          </div>
        </>
      );
      break;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-scrim">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="github-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') cancel();
        }}
        className="w-[460px] max-w-[90vw] rounded-container border border-border bg-surface p-5 [box-shadow:var(--shadow-dialog)]"
      >
        <h2 id="github-title" className="m-0 mb-3 text-[15px] font-semibold">
          {title}
        </h2>
        {body}
      </div>
    </div>
  );
}
