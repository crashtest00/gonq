// The only place the frontend invokes the GitHub commands (OAuth device flow). The token and the device code
// stay in Rust: JS gets the user code to show, the login and whether a token exists. Desktop only; on the web
// every call throws a GitHubError of kind unavailable_on_web, which the caller shows in the error banner.
import { invoke } from '@tauri-apps/api/core';
import { isTauri } from './files';

export type GitHubErrorKind =
  | 'denied'
  | 'expired'
  | 'keychain'
  | 'network'
  | 'not_signed_in'
  | 'unavailable_on_web'
  | 'cancelled'
  | 'other';

export class GitHubError extends Error {
  constructor(
    readonly kind: GitHubErrorKind,
    message: string,
  ) {
    super(message);
    this.name = 'GitHubError';
  }
}

export const GITHUB_UNAVAILABLE = 'Signing in to GitHub needs the Gonq desktop app';

/** What `startSignIn` gives: the code to type at the verification address. */
export interface DeviceStart {
  user_code: string;
  verification_uri: string;
  expires_in: number;
  interval: number;
}

export interface GitHubStatus {
  signed_in: boolean;
  login: string | null;
  /** `session_only` when no keychain could hold the token. */
  storage: 'keychain' | 'session_only' | null;
}

const CAUSES: Record<string, GitHubErrorKind> = {
  access_denied: 'denied',
  expired: 'expired',
  keychain: 'keychain',
  network: 'network',
  not_signed_in: 'not_signed_in',
  cancelled: 'cancelled',
};

const FALLBACK: Record<string, string> = {
  access_denied: 'GitHub sign-in was denied',
  expired: 'The GitHub sign-in code expired',
  keychain: 'The OS keychain failed',
  network: 'Could not reach GitHub',
  not_signed_in: 'Not signed in to GitHub',
  cancelled: 'The GitHub sign-in was cancelled',
  device_flow_disabled: 'Device sign-in is switched off for this GitHub app',
  incorrect_device_code: 'GitHub did not recognise the sign-in code',
  no_sign_in_in_progress: 'No GitHub sign-in is in progress',
  rate_limited: 'GitHub rate limit reached',
};

/** Turns what a command rejected with (`{kind, message?}`, or a string) into a GitHubError. */
export function toGitHubError(e: unknown): GitHubError {
  if (e instanceof GitHubError) return e;
  if (typeof e === 'object' && e !== null && typeof (e as { kind?: unknown }).kind === 'string') {
    const { kind, message, status } = e as { kind: string; message?: unknown; status?: unknown };
    const text =
      typeof message === 'string' && message !== ''
        ? kind === 'keychain' || kind === 'network'
          ? `${FALLBACK[kind]}: ${message}`
          : kind === 'http' && typeof status === 'number'
            ? `GitHub returned ${status}: ${message}`
            : message
        : (FALLBACK[kind] ?? 'GitHub sign-in failed');
    return new GitHubError(CAUSES[kind] ?? 'other', text);
  }
  return new GitHubError('other', typeof e === 'string' ? e : e instanceof Error ? e.message : String(e));
}

async function call<T>(cmd: string): Promise<T> {
  if (!isTauri()) throw new GitHubError('unavailable_on_web', GITHUB_UNAVAILABLE);
  try {
    return await invoke<T>(cmd);
  } catch (e) {
    throw toGitHubError(e);
  }
}

/** Asks GitHub for a code and cancels any earlier sign-in. Opens nothing. */
export const startSignIn = (): Promise<DeviceStart> => call('github_start');

/** Waits until the code is approved (resolves signed in), refused (denied), or expired. */
export const pollSignIn = (): Promise<GitHubStatus> => call('github_poll');

export const signInStatus = (): Promise<GitHubStatus> => call('github_status');

/** Deletes the stored token (and stops a sign-in being polled). Fine when already signed out. */
export const signOut = (): Promise<void> => call('github_sign_out');

type SignInHandler = () => Promise<boolean>;
let signInHandler: SignInHandler | null = null;

/** Registers the sign-in dialog; returns a function that unregisters it. */
export function setSignInHandler(handler: SignInHandler | null): () => void {
  signInHandler = handler;
  return () => {
    if (signInHandler === handler) signInHandler = null;
  };
}

/**
 * Resolves true once signed in: at once when a token already exists, otherwise after the sign-in dialog
 * ran. Resolves false when the user closed the dialog without signing in. Throws a GitHubError when the
 * status cannot be read (on the web: unavailable_on_web).
 */
export async function ensureSignedIn(): Promise<boolean> {
  if ((await signInStatus()).signed_in) return true;
  if (signInHandler === null) throw new GitHubError('other', 'The GitHub sign-in is not available');
  return signInHandler();
}
