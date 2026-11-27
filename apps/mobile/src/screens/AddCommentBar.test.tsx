/** Covers the mobile selection Add Comment bar through renderMobileApp: it follows the CodeMirror selection (shown for a range, hidden when it collapses), sits directly above the AccessoryBar, starts the draft on tap, is not opened by a long press, the editor no longer swallows contextmenu on mobile, and the edge cases: table-cell and a marker-spanning selection (bar shown, falls back to the caret) and Raw mode (enabled, as on desktop). */
import { act, createEvent, fireEvent, screen } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { docText, editorView, select, selectText, settleEditors } from '@gonq/editor/testing/editor';
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

/** Replaces the whole document in the (raw) editor and selects `needle`. */
async function load(text: string, needle: string, raw = true) {
  const { user } = await openNew();
  if (raw) await user.click(screen.getByRole('switch', { name: 'Raw Markdown' }));
  const view = editorView();
  act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: text } }));
  selectText(needle);
  await vi.waitFor(() => expect(bar().dataset.visible).toBe('true'));
  return user;
}
const addBtn = () => screen.getByRole('button', { name: /^Add Comment/ });

it('a selection inside a table cell shows the bar, but Add Comment is disabled (tables take no comment, as on desktop)', async () => {
  await load('| h | i |\n| - | - |\n| alpha | beta |\n', 'alpha');
  expect(addBtn()).toBeDisabled();
});

it('a selection spanning a comment marker is not a commentable range: the bar shows and Add Comment falls back to the caret, as on desktop', async () => {
  const user = await load('The estimate [💬](#md-thread-c20260910143022a3f9c1) holds here.\n', 'estimate [💬](#md-thread-c20260910143022a3f9c1) holds');
  expect(addBtn()).toBeEnabled();
  await user.click(addBtn());
  expect(await screen.findByRole('textbox', { name: 'Comment' })).toBeInTheDocument();
  expect(docText()).toBe('The estimate [💬](#md-thread-c20260910143022a3f9c1) holds here.\n');
});

it('in Raw Markdown mode a selection in a paragraph shows the bar and Add Comment is enabled, exactly as in rendered mode', async () => {
  const user = await load('Hello brave world.\n', 'brave', true);
  expect(addBtn()).toBeEnabled();
  await user.click(addBtn());
  expect(await screen.findByRole('textbox', { name: 'Comment' })).toBeInTheDocument();
});
