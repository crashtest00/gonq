// Window-close interception lives behind this boundary, like file access:
// the desktop app asks the native window, the browser uses beforeunload.
import { getCurrentWindow } from '@tauri-apps/api/window';
import { isTauri } from './files';

/**
 * Calls `confirmClose` when the user tries to close while `isDirty()` is true;
 * the window closes only if it resolves true. Returns an unregister function.
 */
export function guardClose(isDirty: () => boolean, confirmClose: () => Promise<boolean>): () => void {
  if (isTauri()) {
    const win = getCurrentWindow();
    const unlisten = win.onCloseRequested(async (event) => {
      if (!isDirty()) return;
      event.preventDefault();
      if (await confirmClose()) await win.destroy();
    });
    return () => void unlisten.then((fn) => fn());
  }
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (!isDirty()) return;
    e.preventDefault();
    e.returnValue = '';
  };
  window.addEventListener('beforeunload', onBeforeUnload);
  return () => window.removeEventListener('beforeunload', onBeforeUnload);
}
