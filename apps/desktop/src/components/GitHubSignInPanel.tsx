/**
 * The GitHub device-flow sign-in panel, drawn from the shared useSignInController (copyable code, open github.com/login/device, waiting/approved/denied/
 * expired states). It is not a dialog: SettingsDialog shows it inside Settings > GitHub.
 */
import { useState } from 'react';
import { Check, Copy, Loader2 } from 'lucide-react';
import { useSignInController } from '@gonq/editor/controllers/signIn';

const button =
  'h-8 rounded-control border px-3 text-[13px] font-semibold outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50';
const primary = `${button} border-primary bg-primary text-primary-foreground`;
const plain = `${button} border-border bg-transparent`;

const SESSION_ONLY = 'No keychain is available, so this sign-in lasts for this session only.';

function Copyable({ label, text, copy }: { label: string; text: string; copy: (text: string) => Promise<void> }) {
  const [copied, setCopied] = useState(false);
  const [failed, setFailed] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => {
        copy(text).then(
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
 * Shown by Settings > GitHub > Sign In: the device code, waiting for approval on github.com, then the login.
 * Neither the token nor the device code ever reaches here. `onApproved` fires when GitHub approves;
 * `onClose` says whether the user is signed in on the way out.
 */
export function GitHubSignInPanel({
  onApproved,
  onClose,
}: {
  onApproved?: () => void;
  onClose: (signedIn: boolean) => void;
}) {
  const { step, start, stop, copy, openBrowser } = useSignInController({ onApproved });

  const cancel = () => {
    stop();
    onClose(step.name === 'approved');
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
            <Copyable label="Copy code" text={step.start.user_code} copy={copy} />
          </div>
          <div className="mb-3 flex items-center justify-between gap-3 text-[12px] text-muted-foreground">
            <span className="min-w-0 select-all break-all">{step.start.verification_uri}</span>
            <Copyable label="Copy address" text={step.start.verification_uri} copy={copy} />
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
  }

  return (
    <section aria-labelledby="github-signin-title" className="mb-5 rounded-control border border-border p-3">
      <h4 id="github-signin-title" className="m-0 mb-2 text-[13px] font-semibold">
        {title}
      </h4>
      {body}
    </section>
  );
}
