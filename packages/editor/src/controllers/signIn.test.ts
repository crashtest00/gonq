/** useSignInController: re-poll on resume (never two polls in flight), the idle Start after a killed process, and Copy before Open. */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

const startSignIn = vi.fn();
const pollSignIn = vi.fn();
const pendingSignIn = vi.fn();
const signInStatus = vi.fn();
const signOut = vi.fn();
vi.mock('../platform/github', async () => ({
  ...(await vi.importActual<object>('../platform/github')),
  startSignIn: () => startSignIn(),
  pollSignIn: () => pollSignIn(),
  pendingSignIn: () => pendingSignIn(),
  signInStatus: () => signInStatus(),
  signOut: () => signOut(),
}));
const order: string[] = [];
vi.mock('../platform/clipboard', () => ({ copyText: async (t: string) => void order.push(`copy:${t}`) }));
vi.mock('../platform/external', () => ({ openExternal: async (u: string) => void order.push(`open:${u}`) }));

import { GitHubError } from '../platform/github';
import { DEVICE_URL, useSignInController } from './signIn';

const begun = { user_code: 'ABCD-1234', verification_uri: DEVICE_URL, expires_in: 900, interval: 5 };
const signedIn = { signed_in: true, login: 'octo', storage: 'keychain' as const };
const signedOut = { signed_in: false, login: null, storage: null };

let inFlight = 0;
let maxInFlight = 0;
let live: { resolve: (v: unknown) => void; reject: (e: unknown) => void } | null = null;

beforeEach(() => {
  order.length = 0;
  inFlight = maxInFlight = 0;
  live = null;
  startSignIn.mockReset().mockResolvedValue(begun);
  pendingSignIn.mockReset();
  signInStatus.mockReset().mockResolvedValue(signedOut);
  signOut.mockReset().mockResolvedValue(undefined);
  // Like Rust: a new poll cancels the one running, so only the newest is ever in flight.
  pollSignIn.mockReset().mockImplementation(() => {
    live?.reject(new GitHubError('cancelled', 'cancelled'));
    return new Promise((resolve, reject) => {
      inFlight = 1;
      maxInFlight = Math.max(maxInFlight, inFlight);
      live = {
        resolve: (v) => ((inFlight = 0), resolve(v)),
        reject: (e) => ((inFlight = 0), reject(e)),
      };
    });
  });
});

const setVisibility = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  act(() => void document.dispatchEvent(new Event('visibilitychange')));
};

async function waiting() {
  const hook = renderHook(() => useSignInController());
  await act(async () => void hook.result.current.start());
  await waitFor(() => expect(hook.result.current.step.name).toBe('waiting'));
  return hook;
}

it('hide, resume, re-poll, success: one poll in flight at a time', async () => {
  const { result } = await waiting();
  expect(pollSignIn).toHaveBeenCalledTimes(1);
  setVisibility('hidden');
  expect(pendingSignIn).not.toHaveBeenCalled();
  pendingSignIn.mockResolvedValue({ pending: true, expires_at_ms: Date.now() + 60_000 });
  setVisibility('visible');
  await waitFor(() => expect(pollSignIn).toHaveBeenCalledTimes(2));
  expect(result.current.step.name).toBe('waiting');
  act(() => live!.resolve(signedIn));
  await waitFor(() => expect(result.current.step).toEqual({ name: 'approved', status: signedIn }));
  expect(maxInFlight).toBe(1);
});

it('the superseded poll cannot fail the sign-in, and a second resume while asking does nothing extra', async () => {
  const { result } = await waiting();
  pendingSignIn.mockResolvedValue({ pending: true, expires_at_ms: Date.now() + 60_000 });
  setVisibility('visible');
  setVisibility('visible');
  await waitFor(() => expect(pollSignIn).toHaveBeenCalledTimes(2));
  expect(pendingSignIn).toHaveBeenCalledTimes(1);
  expect(result.current.step.name).toBe('waiting');
  expect(maxInFlight).toBe(1);
});

it('a killed process (nothing pending, not signed in) ends in the idle Start state', async () => {
  const { result } = await waiting();
  pendingSignIn.mockResolvedValue({ pending: false, expires_at_ms: null });
  setVisibility('visible');
  await waitFor(() => expect(result.current.step).toEqual({ name: 'idle' }));
  expect(pollSignIn).toHaveBeenCalledTimes(1);
});

it('nothing pending but already signed in is approved', async () => {
  const onApproved = vi.fn();
  const hook = renderHook(() => useSignInController({ onApproved }));
  await act(async () => void hook.result.current.start());
  pendingSignIn.mockResolvedValue({ pending: false, expires_at_ms: null });
  signInStatus.mockResolvedValue(signedIn);
  setVisibility('visible');
  await waitFor(() => expect(hook.result.current.step.name).toBe('approved'));
  act(() => live?.resolve(signedIn));
  expect(onApproved).toHaveBeenCalledTimes(1);
});

it('does not re-poll when not waiting', async () => {
  const hook = renderHook(() => useSignInController());
  setVisibility('visible');
  expect(pendingSignIn).not.toHaveBeenCalled();
  expect(hook.result.current.step.name).toBe('idle');
});

it('Copy code runs copyText, then Open runs openExternal, in that order', async () => {
  const { result } = await waiting();
  await act(() => result.current.copy('ABCD-1234'));
  await act(() => result.current.openBrowser());
  expect(order).toEqual(['copy:ABCD-1234', `open:${DEVICE_URL}`]);
});
