/**
 * Which app this build is: appKind() is 'desktop' unless the build defines __GONQ_APP__ as 'mobile'
 * (M-07 sets it in the mobile Vite config). Shared platform code uses it to degrade features the
 * mobile app does not have (SSH); it exports the message those degraded paths show.
 */

declare global {
  /** Set by a Vite `define` (or a test's vi.stubGlobal); undefined means the desktop app. */
  // eslint-disable-next-line no-var
  var __GONQ_APP__: 'desktop' | 'mobile' | undefined;
}

export type AppKind = 'desktop' | 'mobile';

/** Read on every call, so a test can set __GONQ_APP__ after the module loaded. */
export function appKind(): AppKind {
  return typeof __GONQ_APP__ !== 'undefined' && __GONQ_APP__ === 'mobile' ? 'mobile' : 'desktop';
}

/** Shown in the error banner when anything reaches for a server connection in the mobile app. */
export const CONNECT_UNAVAILABLE_MOBILE = 'Connecting to a server is not part of the Gonq mobile app.';
