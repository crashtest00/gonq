/** openPaths.ts: queued paths, live events and the browser no-op. */
import { vi } from 'vitest';

const invoke = vi.fn();
const unlisten = vi.fn();
const noop = () => {};
let handler: (e: { payload: string[] }) => void = noop;
let tauri = true;
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('@tauri-apps/api/event', () => ({
  listen: async (_name: string, h: typeof handler) => {
    handler = h;
    return unlisten;
  },
}));
vi.mock('./files', () => ({ isTauri: () => tauri }));

import { listenOpenPaths, takePendingOpenPaths } from './openPaths';

beforeEach(() => {
  tauri = true;
  invoke.mockReset();
  unlisten.mockReset();
});

test('takes the queued paths from the native side', async () => {
  invoke.mockResolvedValue(['/a b/é.md']);
  expect(await takePendingOpenPaths()).toEqual(['/a b/é.md']);
  expect(invoke).toHaveBeenCalledWith('take_launch_paths');
});

test('forwards event payloads and unregisters', async () => {
  const cb = vi.fn();
  const stop = listenOpenPaths(cb);
  await vi.waitFor(() => expect(handler).not.toBe(noop));
  handler({ payload: ['/x.md'] });
  expect(cb).toHaveBeenCalledWith(['/x.md']);
  stop();
  await vi.waitFor(() => expect(unlisten).toHaveBeenCalled());
});

test('in the browser nothing is delivered and nothing throws', async () => {
  tauri = false;
  expect(await takePendingOpenPaths()).toEqual([]);
  expect(() => listenOpenPaths(() => {})()).not.toThrow();
  expect(invoke).not.toHaveBeenCalled();
});
