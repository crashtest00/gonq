/**
 * onResume: calls back when the app comes back to the foreground. That is `document.visibilitychange` to
 * visible everywhere, plus Tauri's `tauri://resumed` window event, which Tauri 2.12 emits on Android
 * (Activity.onResume) and iOS only. The event name lives only in this file; in the browser only the first applies.
 */
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './files';

const RESUMED_EVENT = 'tauri://resumed';

/** Runs `onBack` on every resume. Returns an unregister function. */
export function onResume(onBack: () => void): () => void {
  const visible = () => {
    if (document.visibilityState === 'visible') onBack();
  };
  document.addEventListener('visibilitychange', visible);
  let unlisten: Promise<() => void> = Promise.resolve(() => {});
  if (isTauri()) {
    unlisten = Promise.resolve()
      .then(() => listen(RESUMED_EVENT, () => onBack()))
      .catch(() => () => {});
  }
  return () => {
    document.removeEventListener('visibilitychange', visible);
    void unlisten.then((fn) => fn());
  };
}
