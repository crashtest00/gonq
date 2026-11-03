/**
 * The Android system Back key behind the platform boundary: onAndroidBack(handler) registers Tauri's official
 * back-button hook (`onBackButtonPress` from @tauri-apps/api/app) and returns an unregister function; leaveApp() ends
 * the app (the Android default when nothing is left to go back to). Registering takes over Back from Android, so the
 * handler must always decide; the hook rides on the activity's OnBackPressedDispatcher, which keeps predictive Back working.
 * Outside the Tauri Android shell (Beta, desktop) nothing is registered and the browser's own Back is untouched.
 */
import { exit, onBackButtonPress } from '@tauri-apps/api/app';
import { isTauri } from './tauri';

/** True in the Tauri webview on Android, the only place the Back hook exists. */
export function hasBackButton(): boolean {
  return isTauri() && typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent);
}

/** Calls `handler` on every system Back press until the returned function is called; a no-op registration off Android. */
export function onAndroidBack(handler: () => void): () => void {
  if (!hasBackButton()) return () => {};
  const listener = onBackButtonPress(() => handler());
  return () => void listener.then((l) => l.unregister());
}

/** Leaves the app, as Android's default Back does at the root. */
export function leaveApp(): Promise<void> {
  return exit(0);
}
