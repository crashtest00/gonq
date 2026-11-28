/** The marker of the thread open in the mobile Comments sheet is active (cm-thread-active, aria-current): the list view, Back, a new-comment draft, closing the sheet and deleting the thread clear it; a resolved thread keeps its resolved look. */
import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
const disk = vi.hoisted(() => ({ text: '' }));
vi.mock('@tauri-apps/plugin-fs', async (orig) => ({
  ...(await orig<object>()),
  readFile: vi.fn(async () => new TextEncoder().encode(disk.text)),
  writeTextFile: vi.fn(async () => {}),
}));

import { settleEditors } from '@gonq/editor/testing/editor';
import { renderMobileApp } from '../testing/renderMobileApp';

const A = 'c20260910143022a3f9c1';
const B = 'c20260910143022a3f9c2';
const blk = (id: string, status: string, body: string) => `<!--\n@thread ${id}\n@status ${status}\n\n[User | 2026-09-10T14:30:22+02:00]\n${body}\n-->`;
const DOC = `Para [💬](#md-thread-${A}) one [✅](#md-thread-${B}) two.\n\n${blk(A, 'open', 'First?')}\n\n${blk(B, 'resolved', 'Second?')}\n`;

beforeEach(() => {
  disk.text = DOC;
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve([{ path: '/d/a.md', opened_at: Date.now() }]);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    if (cmd === 'path_exists') return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

const active = () => (settleEditors(document.body), Array.from(document.querySelectorAll<HTMLElement>('.cm-thread-active')).map((m) => m.dataset.threadId));
const sheet = () => within(screen.getByRole('dialog', { name: 'Comments' }));

async function start() {
  const app = await renderMobileApp();
  await app.user.click(await screen.findByRole('button', { name: /^a\.md/ }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  await settleEditors(document.body);
  await app.user.click(screen.getByRole('button', { name: 'Comments' }));
  await screen.findByRole('dialog', { name: 'Comments' });
  return app.user;
}

it('the thread open in the sheet is active; the list, Back and closing the sheet clear it', async () => {
  const user = await start();
  expect(active()).toEqual([]);
  await user.click(await sheet().findByRole('button', { name: /First\?/ }));
  expect(active()).toEqual([A]);
  expect(document.querySelector('.cm-thread-active')!.getAttribute('aria-current')).toBe('true');
  await user.click(sheet().getByRole('button', { name: 'Back' }));
  expect(active()).toEqual([]);
  await user.click(await sheet().findByRole('button', { name: /Second\?/ }));
  expect(active()).toEqual([B]);
  expect(document.querySelector('.cm-thread-active')!.classList.contains('cm-thread-resolved')).toBe(true);
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  expect(screen.queryByRole('dialog', { name: 'Comments' })).toBeNull();
  expect(active()).toEqual([]);
});

it('a new-comment draft and deleting the open thread leave no active marker', async () => {
  const user = await start();
  await user.click(await sheet().findByRole('button', { name: /First\?/ }));
  await user.click(sheet().getByRole('button', { name: 'Delete thread' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  expect(active()).toEqual([]);
  await user.click(await sheet().findByRole('button', { name: 'Add comment' }));
  expect(active()).toEqual([]);
});
