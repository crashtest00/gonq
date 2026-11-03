/** onAndroidBack and leaveApp: registered only inside the Tauri webview on Android (Beta and desktop get nothing), through Tauri's onBackButtonPress, unregistered on cleanup; leaveApp exits the app. */
import { afterEach, expect, it, vi } from 'vitest';

const unregister = vi.fn(async () => {});
const onBackButtonPress = vi.fn(async (_h: (p: { canGoBack: boolean }) => void) => ({ unregister }));
const exit = vi.fn(async (_code?: number) => {});
vi.mock('@tauri-apps/api/app', () => ({ onBackButtonPress: (h: (p: { canGoBack: boolean }) => void) => onBackButtonPress(h), exit: (c?: number) => exit(c) }));

import { hasBackButton, leaveApp, onAndroidBack } from './backButton';

const setUa = (ua: string) => Object.defineProperty(navigator, 'userAgent', { value: ua, configurable: true });
const original = navigator.userAgent;
afterEach(() => {
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  setUa(original);
  vi.clearAllMocks();
});

it('registers nothing in a browser, even an Android one (Beta)', () => {
  setUa('Mozilla/5.0 (Linux; Android 14) Chrome/120');
  expect(hasBackButton()).toBe(false);
  onAndroidBack(() => {})();
  expect(onBackButtonPress).not.toHaveBeenCalled();
});

it('registers nothing in the desktop app', () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  setUa('Mozilla/5.0 (X11; Linux x86_64)');
  onAndroidBack(() => {});
  expect(onBackButtonPress).not.toHaveBeenCalled();
});

it('hooks onBackButtonPress in the Android app, calls the handler on each press and unregisters', async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  setUa('Mozilla/5.0 (Linux; Android 14) Chrome/120');
  const handler = vi.fn();
  const off = onAndroidBack(handler);
  expect(onBackButtonPress).toHaveBeenCalledTimes(1);
  onBackButtonPress.mock.calls[0][0]({ canGoBack: false });
  onBackButtonPress.mock.calls[0][0]({ canGoBack: true });
  expect(handler).toHaveBeenCalledTimes(2);
  off();
  await vi.waitFor(() => expect(unregister).toHaveBeenCalledTimes(1));
});

it('leaves the app with exit(0)', async () => {
  await leaveApp();
  expect(exit).toHaveBeenCalledWith(0);
});
