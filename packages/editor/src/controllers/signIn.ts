/**
 * useSignInController: the GitHub device-flow state machine shared by every shell (the desktop panel today, the
 * mobile sign-in screen next). Owns the step (idle, starting, waiting, approved, denied, expired, failed), the
 * poll, stopping it on cancel or unmount, and re-polling when the app resumes (a phone may suspend Gonq while
 * the user approves in the browser). It renders nothing: the shell draws the step and calls `start`, `stop`,
 * `copy` and `openBrowser`. The token and the device code never leave Rust; only the user code is shown.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { copyText } from '../platform/clipboard';
import { openExternal } from '../platform/external';
import {
  pendingSignIn,
  pollSignIn,
  signInStatus,
  signOut,
  startSignIn,
  toGitHubError,
  type DeviceStart,
  type GitHubStatus,
} from '../platform/github';
import { onResume } from '../platform/resume';

export const DEVICE_URL = 'https://github.com/login/device';

export type SignInStep =
  | { name: 'idle' }
  | { name: 'starting' }
  | { name: 'waiting'; start: DeviceStart; openFailed: string | null }
  | { name: 'approved'; status: GitHubStatus }
  | { name: 'denied' }
  | { name: 'expired' }
  | { name: 'failed'; message: string };

export function useSignInController({ onApproved }: { onApproved?: () => void } = {}) {
  const [step, setStep] = useState<SignInStep>({ name: 'idle' });
  const stepRef = useRef(step);
  stepRef.current = step;
  const approvedCb = useRef(onApproved);
  approvedCb.current = onApproved;
  const live = useRef(true);
  /** Bumped by every Start and by stop/unmount, so a late reply from an abandoned sign-in is ignored. */
  const run = useRef(0);
  /** Bumped by every poll and by any other way the waiting ends, so only the newest poll may settle the step. */
  const pollSeq = useRef(0);
  const polling = useRef(false);
  /** True while a resume is asking Rust whether the sign-in is still pending: a second resume waits. */
  const resuming = useRef(false);

  /** Stops the sign-in being polled: Rust ends it when a sign out arrives (nothing is stored yet). */
  const stop = useCallback(() => {
    run.current++;
    pollSeq.current++;
    if (!polling.current) return;
    polling.current = false;
    signOut().catch(() => {});
  }, []);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
      stop();
    };
  }, [stop]);

  const approve = (status: GitHubStatus) => {
    pollSeq.current++;
    polling.current = false;
    setStep({ name: 'approved', status });
    approvedCb.current?.();
  };

  /** Waits for the code to be approved. A newer poll supersedes this one (Rust cancels the older), so at most one settles. */
  const poll = async (mine: number) => {
    const seq = ++pollSeq.current;
    const stale = () => !live.current || run.current !== mine || pollSeq.current !== seq;
    polling.current = true;
    try {
      const done = await pollSignIn();
      if (stale()) return;
      approve(done);
    } catch (e) {
      if (stale()) return;
      polling.current = false;
      const err = toGitHubError(e);
      if (err.kind === 'denied') setStep({ name: 'denied' });
      else if (err.kind === 'expired') setStep({ name: 'expired' });
      else setStep({ name: 'failed', message: err.message });
    }
  };

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
    await poll(mine);
  };

  // The app came back while waiting. If Rust still has the code, poll again (superseding a poll that may have
  // been frozen with the app). If not, the code was approved meanwhile, or the process was killed and lost it:
  // signed in means approved, otherwise the plain idle Start.
  const waiting = step.name === 'waiting';
  useEffect(() => {
    if (!waiting) return;
    return onResume(() => {
      if (resuming.current || stepRef.current.name !== 'waiting') return;
      resuming.current = true;
      const mine = run.current;
      const current = () => live.current && run.current === mine;
      void (async () => {
        try {
          const pending = await pendingSignIn();
          if (!current()) return;
          if (pending.pending) {
            void poll(mine);
            return;
          }
          const status = await signInStatus();
          if (!current()) return;
          if (status.signed_in) approve(status);
          else {
            pollSeq.current++;
            polling.current = false;
            setStep({ name: 'idle' });
          }
        } catch {
          // Could not ask (offline): keep waiting; the next resume asks again.
        } finally {
          resuming.current = false;
        }
      })();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- poll/approve only touch refs and setStep
  }, [waiting]);

  /** Copies the user code or address; rejects if the clipboard refuses. */
  const copy = (text: string) => copyText(text);

  const openBrowser = async () => {
    try {
      await openExternal(DEVICE_URL);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      setStep((s) => (s.name === 'waiting' ? { ...s, openFailed: message } : s));
    }
  };

  return { step, start, stop, copy, openBrowser };
}
