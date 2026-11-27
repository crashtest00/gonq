/** Covers the mobile selection Add Comment bar through renderMobileApp: it follows the CodeMirror selection (shown for a range, hidden when it collapses), sits directly above the AccessoryBar, starts the draft on tap, is not opened by a long press, and the editor no longer swallows contextmenu on mobile. */
import { createEvent, fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { select, selectText, settleEditors } from '@gonq/editor/testing/editor';
import { renderMobileApp } from '../testing/renderMobileApp';

beforeEach(() => {
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve([]);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    return Promise.resolve(undefined);
  });
});

async function openNew() {
  const app = await renderMobileApp();
  await app.user.click(screen.getByRole('button', { name: 'New' }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  await settleEditors(document.body);
  return app;
}
const bar = () => document.querySelector<HTMLElement>('.m-addcomment')!;

it('is hidden with a caret, shown for a range directly above the accessory bar, hidden again when it collapses', async () => {
  const { user } = await openNew();
  await user.click(screen.getByRole('switch', { name: 'Raw Markdown' }));
  await user.type(document.querySelector<HTMLElement>('.cm-content')!, 'Hello brave world.');
  expect(bar().dataset.visible).toBe('false');
  selectText('brave');
  await screen.findByRole('button', { name: /^Add Comment/ });
  expect(bar().dataset.visible).toBe('true');
  expect(bar().nextElementSibling).toBe(screen.getByRole('toolbar', { name: 'Editing' }));
  select(3, 3);
  await vi.waitFor(() => expect(bar().dataset.visible).toBe('false'));
});

it('tapping it opens the draft anchored to the selection and keeps the selection (pointer-down is cancelled)', async () => {
  const { user } = await openNew();
  await user.click(screen.getByRole('switch', { name: 'Raw Markdown' }));
  await user.type(document.querySelector<HTMLElement>('.cm-content')!, 'Hello brave world.');
  await user.click(screen.getByRole('switch', { name: 'Raw Markdown' }));
  selectText('brave');
  const btn = await screen.findByRole('button', { name: /^Add Comment/ });
  const down = createEvent.pointerDown(btn);
  fireEvent(btn, down);
  expect(down.defaultPrevented).toBe(true);
  await user.click(btn);
  expect(await screen.findByRole('textbox', { name: 'Comment' })).toBeInTheDocument();
});

it('a long press (held touch) opens no sheet, and the editor leaves contextmenu to the OS', async () => {
  await openNew();
  const content = document.querySelector<HTMLElement>('.cm-content')!;
  const ev = createEvent.contextMenu(content, { bubbles: true, cancelable: true });
  fireEvent(content, ev);
  expect(ev.defaultPrevented).toBe(false);
  expect(screen.queryByRole('dialog', { name: 'Editor' })).toBeNull();
});
