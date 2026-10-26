import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import {
  GITHUB_UNAVAILABLE,
  GitHubError,
  ensureSignedIn,
  listRepos,
  pollSignIn,
  setSignInHandler,
  signInStatus,
  signOut,
  startSignIn,
  toGitHubError,
} from './github';

const out = { signed_in: false, login: null, storage: null };
const inn = { signed_in: true, login: 'octo', storage: 'keychain' };

beforeEach(() => {
  invoke.mockReset();
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  setSignInHandler(null);
});

describe('wrappers', () => {
  it.each([
    ['startSignIn', startSignIn, 'github_start'],
    ['pollSignIn', pollSignIn, 'github_poll'],
    ['signInStatus', signInStatus, 'github_status'],
    ['signOut', signOut, 'github_sign_out'],
  ])('%s invokes %s and returns its result', async (_n, fn, cmd) => {
    invoke.mockResolvedValue({ ok: 1 });
    await expect(fn()).resolves.toEqual({ ok: 1 });
    expect(invoke).toHaveBeenCalledWith(cmd);
  });

  it.each([startSignIn, pollSignIn, signInStatus, signOut])('throws unavailable_on_web on the web', async (fn) => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    const err = await fn().catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.kind).toBe('unavailable_on_web');
    expect(err.message).toBe(GITHUB_UNAVAILABLE);
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('error mapping', () => {
  it.each([
    [{ kind: 'access_denied' }, 'denied'],
    [{ kind: 'expired' }, 'expired'],
    [{ kind: 'keychain', message: 'locked' }, 'keychain'],
    [{ kind: 'network', message: 'timed out' }, 'network'],
    [{ kind: 'not_signed_in' }, 'not_signed_in'],
    [{ kind: 'cancelled' }, 'cancelled'],
    [{ kind: 'device_flow_disabled' }, 'other'],
    [{ kind: 'http', status: 500, message: 'boom' }, 'other'],
    ['plain text', 'other'],
  ])('maps %j to %s', async (payload, kind) => {
    invoke.mockRejectedValue(payload);
    const err = await signInStatus().catch((e) => e);
    expect(err).toBeInstanceOf(GitHubError);
    expect(err.kind).toBe(kind);
    expect(err.message).not.toBe('');
  });

  it('keeps the detail in the message', () => {
    expect(toGitHubError({ kind: 'keychain', message: 'locked' }).message).toBe('The OS keychain failed: locked');
    expect(toGitHubError({ kind: 'http', status: 500, message: 'boom' }).message).toBe('GitHub returned 500: boom');
    expect(toGitHubError(new Error('x')).message).toBe('x');
  });
});

describe('ensureSignedIn', () => {
  it('returns true without the dialog when already signed in', async () => {
    const handler = vi.fn();
    setSignInHandler(handler);
    invoke.mockResolvedValue(inn);
    await expect(ensureSignedIn()).resolves.toBe(true);
    expect(handler).not.toHaveBeenCalled();
  });

  it('runs the dialog when signed out and returns what it says', async () => {
    invoke.mockResolvedValue(out);
    setSignInHandler(async () => true);
    await expect(ensureSignedIn()).resolves.toBe(true);
    setSignInHandler(async () => false);
    await expect(ensureSignedIn()).resolves.toBe(false);
  });

  it('throws on the web', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(ensureSignedIn()).rejects.toMatchObject({ kind: 'unavailable_on_web' });
  });

  it('throws when no dialog is registered', async () => {
    invoke.mockResolvedValue(out);
    await expect(ensureSignedIn()).rejects.toBeInstanceOf(GitHubError);
  });
});

describe('listRepos', () => {
  it('asks for the page and maps the reply to camelCase', async () => {
    invoke.mockResolvedValue({
      repos: [{ owner: 'o', name: 'r', full_name: 'o/r', private: true, default_branch: 'dev', can_push: false, pushed_at: null }],
      next_page: 3,
    });
    await expect(listRepos(2)).resolves.toEqual({
      repos: [{ owner: 'o', name: 'r', fullName: 'o/r', private: true, defaultBranch: 'dev', canPush: false, pushedAt: null }],
      nextPage: 3,
    });
    expect(invoke).toHaveBeenCalledWith('github_list_repos', { page: 2 });
  });

  it('maps a revoked token to not_signed_in', async () => {
    invoke.mockRejectedValue({ kind: 'not_signed_in' });
    await expect(listRepos(1)).rejects.toMatchObject({ kind: 'not_signed_in' });
  });

  it('throws unavailable_on_web on the web', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(listRepos(1)).rejects.toMatchObject({ kind: 'unavailable_on_web' });
    expect(invoke).not.toHaveBeenCalled();
  });
});
