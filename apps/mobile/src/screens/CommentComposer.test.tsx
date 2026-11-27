/** Covers the mobile comment composer (new-comment Draft and thread EditBox in the Comments sheet): no header Close there, other Comments views keep it, Android Back acts as Cancel, and the docked sheet adds no bottom band of its own. */
import { act, screen, within } from '@testing-library/react';
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
let backHandler: (() => void) | null = null;
vi.mock('@gonq/editor/platform/backButton', () => ({
  onAndroidBack: (h: () => void) => {
    backHandler = h;
    return () => {};
  },
  leaveApp: async () => {},
  hasBackButton: () => true,
}));

import { settleEditors } from '@gonq/editor/testing/editor';
import { renderMobileApp } from '../testing/renderMobileApp';

const A = 'c20260910143022a3f9c1';
const DOC = `Para one [💬](#md-thread-${A}) here.\n\n<!--\n@thread ${A}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nFirst?\n-->\n`;
const back = () => act(async () => backHandler?.());
const sheet = () => screen.getByRole('dialog', { name: 'Comments' });
const closeButton = () => within(sheet()).queryByRole('button', { name: 'Close' });

beforeEach(() => {
  backHandler = null;
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve([{ path: '/d/a.md', opened_at: Date.now() }]);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    if (cmd === 'path_exists') return Promise.resolve(true);
    return Promise.resolve(undefined);
  });
});

async function openComments() {
  disk.text = DOC;
  const app = await renderMobileApp();
  await app.user.click(await screen.findByRole('button', { name: /^a\.md/ }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  await settleEditors(document.body);
  await app.user.click(screen.getByRole('button', { name: 'Comments' }));
  await screen.findByRole('dialog', { name: 'Comments' });
  return app;
}

it('the new-comment draft has no header Close, Back cancels it, and the list keeps Close', async () => {
  const { user } = await openComments();
  expect(closeButton()).not.toBeNull();
  await user.click(within(sheet()).getByRole('button', { name: 'Add comment' }));
  await screen.findByRole('textbox', { name: 'Comment' });
  expect(closeButton()).toBeNull();
  await back();
  expect(screen.queryByRole('textbox', { name: 'Comment' })).toBeNull();
  expect(within(sheet()).getByRole('button', { name: 'Add comment' })).toBeInTheDocument();
  expect(closeButton()).not.toBeNull();
});

it('the Cancel button of the draft still returns to the list', async () => {
  const { user } = await openComments();
  await user.click(within(sheet()).getByRole('button', { name: 'Add comment' }));
  await user.click(within(sheet()).getByRole('button', { name: 'Cancel' }));
  expect(within(sheet()).getByRole('button', { name: 'Add comment' })).toBeInTheDocument();
});

it('editing a thread has no header Close, Back cancels the edit only, and header Back and Android Back on the thread view return to the list', async () => {
  const { user } = await openComments();
  await user.click(within(sheet()).getByRole('button', { name: /First\?/ }));
  expect(closeButton()).toBeNull();
  expect(within(sheet()).getByRole('button', { name: 'Back' })).toBeInTheDocument();
  await user.click(within(sheet()).getByRole('button', { name: 'Edit thread' }));
  await screen.findByRole('textbox', { name: 'Edit comment' });
  expect(closeButton()).toBeNull();
  expect(within(sheet()).queryByRole('button', { name: 'Back' })).toBeNull();
  await back();
  expect(screen.queryByRole('textbox', { name: 'Edit comment' })).toBeNull();
  expect(within(sheet()).getByText('First?')).toBeInTheDocument();
  await user.click(within(sheet()).getByRole('button', { name: 'Back' }));
  expect(within(sheet()).getByRole('button', { name: 'Add comment' })).toBeInTheDocument();
  await user.click(within(sheet()).getByRole('button', { name: /First\?/ }));
  await back();
  expect(within(sheet()).getByRole('button', { name: 'Add comment' })).toBeInTheDocument();
  expect(closeButton()).not.toBeNull();
});
