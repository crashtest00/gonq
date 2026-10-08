import { vi } from 'vitest';

type CloseEvent = { preventDefault: () => void };
let handler: (e: CloseEvent) => Promise<void>;
const destroy = vi.fn(async () => {});
const unlisten = vi.fn();

vi.mock('@tauri-apps/api/window', () => ({
  getCurrentWindow: () => ({
    onCloseRequested: async (h: typeof handler) => {
      handler = h;
      return unlisten;
    },
    destroy,
  }),
}));
vi.mock('./files', () => ({ isTauri: () => true }));

import { guardClose } from './lifecycle';

async function requestClose(dirty: boolean, confirm: () => Promise<boolean>) {
  guardClose(() => dirty, confirm);
  await Promise.resolve();
  const event = { preventDefault: vi.fn() };
  await handler(event);
  return event;
}

beforeEach(() => destroy.mockClear());

test('a clean window closes without asking', async () => {
  const confirm = vi.fn(async () => true);
  const event = await requestClose(false, confirm);
  expect(confirm).not.toHaveBeenCalled();
  expect(event.preventDefault).not.toHaveBeenCalled();
  expect(destroy).not.toHaveBeenCalled();
});

test('Cancel prevents the close', async () => {
  const event = await requestClose(true, async () => false);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(destroy).not.toHaveBeenCalled();
});

test('confirmed (Save or Don\'t save) destroys the window', async () => {
  const event = await requestClose(true, async () => true);
  expect(event.preventDefault).toHaveBeenCalled();
  expect(destroy).toHaveBeenCalledTimes(1);
});
