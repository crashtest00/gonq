/** The GitHub "unavailable" messages under __GONQ_APP__ = 'mobile' name "the Gonq app"; desktop keeps "the Gonq desktop app". */
import { afterEach, expect, it, vi } from 'vitest';
import { GITHUB_UNAVAILABLE, startSignIn } from './github';

afterEach(() => vi.unstubAllGlobals());

it('says the Gonq app on mobile web', async () => {
  vi.stubGlobal('__GONQ_APP__', 'mobile');
  await expect(startSignIn()).rejects.toMatchObject({ kind: 'unavailable_on_web', message: 'Signing in to GitHub needs the Gonq app' });
});

it('keeps the desktop wording on desktop web', async () => {
  vi.stubGlobal('__GONQ_APP__', undefined);
  await expect(startSignIn()).rejects.toMatchObject({ message: GITHUB_UNAVAILABLE });
  expect(GITHUB_UNAVAILABLE).toBe('Signing in to GitHub needs the Gonq desktop app');
});
