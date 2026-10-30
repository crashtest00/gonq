/** onResume: fires on visibilitychange to visible and on tauri://resumed, and stops after unregistering. */
import { expect, it, vi } from 'vitest';

let tauriHandler: (() => void) | null = null;
const unlisten = vi.fn();
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (name: string, h: () => void) => {
    if (name === 'tauri://resumed') tauriHandler = h;
    return unlisten;
  },
}));
vi.mock('./files', () => ({ isTauri: () => true }));

import { onResume } from './resume';

const visibility = (state: 'hidden' | 'visible') => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
};

it('calls back when the page becomes visible, not when it hides', () => {
  const back = vi.fn();
  const off = onResume(back);
  visibility('hidden');
  expect(back).not.toHaveBeenCalled();
  visibility('visible');
  expect(back).toHaveBeenCalledTimes(1);
  off();
  visibility('visible');
  expect(back).toHaveBeenCalledTimes(1);
});

it('calls back on Tauri\'s resumed event and unlistens on unregister', async () => {
  const back = vi.fn();
  const off = onResume(back);
  await vi.waitFor(() => expect(tauriHandler).not.toBeNull());
  tauriHandler!();
  expect(back).toHaveBeenCalledTimes(1);
  off();
  await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
});
