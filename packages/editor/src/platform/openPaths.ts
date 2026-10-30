// Paths the OS hands to Gonq (double-clicking a .md file, "Open with", a second launch) arrive here.
// The Rust side queues them until the frontend asks, then emits an event while the app runs.
// The command and event names live only in this file. In the browser nothing is ever delivered.
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isTauri } from './files';

const TAKE_COMMAND = 'take_launch_paths';
const OPEN_EVENT = 'launch-open-paths';

/** The paths queued before the frontend was ready; the native side forgets them once returned. */
export async function takePendingOpenPaths(): Promise<string[]> {
  if (!isTauri()) return [];
  return invoke<string[]>(TAKE_COMMAND);
}

/** Calls `onPaths` for every launch while the app runs. Returns an unregister function. */
export function listenOpenPaths(onPaths: (paths: string[]) => void): () => void {
  if (!isTauri()) return () => {};
  // Without a working event bridge there is nothing to receive; startup paths still come from the command.
  const unlisten = Promise.resolve()
    .then(() => listen<string[]>(OPEN_EVENT, (e) => onPaths(e.payload)))
    .catch(() => () => {});
  return () => void unlisten.then((fn) => fn());
}
