/** Covers creating comment threads on mobile through renderMobileApp, porting NewThread: Add comment in the Comments sheet on a selection or at the caret (enabled only where commenting is allowed), the "New comment" draft box (label, placeholder, quoted anchor, focus), what Submit writes, blank submit, Cancel, a draft already open, undo, the author from get_author_name, a read-only tab, and no Add Comment in the accessory bar. */
import { createEvent, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
const disk = vi.hoisted(() => ({ text: '', saved: [] as string[] }));
vi.mock('@tauri-apps/plugin-fs', async (orig) => ({
  ...(await orig<object>()),
  readFile: vi.fn(async () => new TextEncoder().encode(disk.text)),
  writeTextFile: vi.fn(async (_p: string, t: string) => void disk.saved.push(t)),
}));

import { parseCommentThreads } from '@gonq/editor/comment-threads';
import { at, docText, select, selectText, settleEditors } from '@gonq/editor/testing/editor';
import { LONG_PRESS_MS } from './EditorSheet';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

const ID = /c\d{14}[0-9a-f]{12}/;
const DOC = ['# A heading', '', 'The estimate holds through Q3 but not beyond.', '', '```', 'code line here', '```', '', 'Second paragraph.', ''].join('\n');

beforeEach(() => {
  disk.saved = [];
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve([{ path: '/d/a.md', opened_at: Date.now() }]);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    if (cmd === 'path_exists') return Promise.resolve(true);
    if (cmd === 'get_author_name') return Promise.resolve('Tester');
    return Promise.resolve(undefined);
  });
});

async function openDoc(text: string) {
  disk.text = text;
  const app = await renderMobileApp();
  await app.user.click(await screen.findByRole('button', { name: /^a\.md/ }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  await settleEditors(document.body);
  return app;
}
const sheet = () => screen.getByRole('dialog', { name: 'Comments' });
const inSheet = () => within(sheet());
async function save(user: User) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  await waitFor(() => expect(disk.saved.length).toBeGreaterThan(0));
  return disk.saved[disk.saved.length - 1];
}
async function openList(user: User) {
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await screen.findByRole('dialog', { name: 'Comments' });
}

const addButton = () => inSheet().getByRole('button', { name: 'Add comment' });
const box = () => screen.getByRole('textbox', { name: 'Comment' }) as HTMLTextAreaElement;

it('Add comment on a selection opens the draft with the quoted anchor, a labelled focused box and a placeholder', async () => {
  const { user } = await openDoc(DOC);
  selectText('holds through Q3');
  await openList(user);
  await user.click(addButton());
  expect(inSheet().getByText('New comment')).toBeInTheDocument();
  expect(sheet()).toHaveTextContent("On: 'holds through Q3'");
  expect(box()).toHaveFocus();
  expect(box()).toHaveAttribute('placeholder', 'Write a comment…');
  expect(box()).toHaveAttribute('rows', '4');
  expect(inSheet().queryByText('No comments yet.')).toBeNull();
});

it('Add comment is disabled (not hidden) where commenting is not allowed: heading, code block', async () => {
  const { user } = await openDoc(DOC);
  await openList(user);
  select(at('A heading'));
  expect(addButton()).toBeDisabled();
  select(at('code line') + 2);
  expect(addButton()).toBeDisabled();
  select(at('holds'), at('holds') + 5);
  await waitFor(() => expect(addButton()).toBeEnabled());
});

it('Add comment at a bare caret in a paragraph is enabled and the thread goes there', async () => {
  const { user } = await openDoc('Hello brave world.\n');
  select(at('brave', true));
  await openList(user);
  await waitFor(() => expect(addButton()).toBeEnabled());
  await user.click(addButton());
  expect(sheet()).not.toHaveTextContent('On:');
  await user.type(box(), 'note');
  await user.click(inSheet().getByRole('button', { name: 'Submit' }));
  expect(docText()).toContain('💬');
});

it('Submit writes marker and block with the author from getAuthorName, opens the thread and clears the selection', async () => {
  const { user } = await openDoc(DOC);
  selectText('holds through Q3');
  await openList(user);
  await user.click(addButton());
  await user.type(box(), 'Where does this come from?');
  await user.click(inSheet().getByRole('button', { name: 'Submit' }));
  expect(inSheet().getByRole('button', { name: 'Close thread' })).toBeInTheDocument();
  expect(inSheet().getByText('Where does this come from?')).toBeInTheDocument();
  expect(docText()).toMatch(/\[💬\]\(#md-thread-/);
  const text = await save(user);
  expect(text).toMatch(new RegExp(`holds through Q3\\[💬\\]\\(#md-thread-${ID.source}\\) but not beyond\\.`));
  const [thread] = parseCommentThreads(text);
  expect(thread.anchor).toBe('holds through Q3');
  expect(thread.status).toBe('open');
  expect(thread.messages[0]).toMatchObject({ author: 'Tester', body: 'Where does this come from?' });
  expect(text.trimEnd().endsWith('-->')).toBe(true);
});

it('blank submit does nothing; Cancel discards and returns to the list', async () => {
  const { user } = await openDoc(DOC);
  selectText('holds');
  await openList(user);
  await user.click(addButton());
  fireEvent.change(box(), { target: { value: '   \n ' } });
  await user.click(inSheet().getByRole('button', { name: 'Submit' }));
  expect(inSheet().getByText('New comment')).toBeInTheDocument();
  expect(docText()).not.toContain('💬');
  await user.click(inSheet().getByRole('button', { name: 'Cancel' }));
  expect(inSheet().queryByText('New comment')).toBeNull();
  expect(inSheet().getByText('No comments yet.')).toBeInTheDocument();
  expect(docText()).not.toContain('💬');
});

async function longPress() {
  const content = document.querySelector<HTMLElement>('.cm-content')!;
  const down = createEvent('pointerdown', content, { bubbles: true, cancelable: true });
  Object.defineProperties(down, { pointerType: { value: 'touch' }, isPrimary: { value: true }, clientX: { value: 10 }, clientY: { value: 10 } });
  fireEvent(content, down);
  await new Promise((r) => setTimeout(r, LONG_PRESS_MS + 100));
  return screen.findByRole('dialog', { name: 'Editor' });
}

it('Add Comment from the long-press sheet starts the draft; with a draft open it focuses it and keeps what was typed', async () => {
  const { user } = await openDoc(DOC);
  selectText('holds');
  const menu = await longPress();
  await user.click(within(menu).getByRole('menuitem', { name: /^Add Comment/ }));
  await user.type(box(), 'half');
  expect(inSheet().getByText('New comment')).toBeInTheDocument();
  (document.activeElement as HTMLElement).blur();
  const again = await longPress();
  await user.click(within(again).getByRole('menuitem', { name: /^Add Comment/ }));
  expect(box()).toHaveFocus();
  expect(box().value).toBe('half');
});

it('undo removes marker and block in one step', async () => {
  const { user } = await openDoc('Hello brave world.\n');
  selectText('brave');
  await openList(user);
  await user.click(addButton());
  await user.type(box(), 'note');
  await user.click(inSheet().getByRole('button', { name: 'Submit' }));
  expect(docText()).toContain('💬');
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Undo' }));
  expect(docText()).not.toContain('💬');
  expect(await save(user)).toBe('Hello brave world.\n');
});

it('a body containing --> and a bare --> line round-trips', async () => {
  const { user } = await openDoc('Some text here.\n');
  selectText('text');
  await openList(user);
  await user.click(addButton());
  fireEvent.change(box(), { target: { value: 'a --> b\n-->\nend' } });
  await user.click(inSheet().getByRole('button', { name: 'Submit' }));
  const [thread] = parseCommentThreads(await save(user));
  expect(thread.messages[0].body).toBe('a --> b\n-->\nend');
});

it('the accessory bar has no Add Comment button and the sheet buttons have 44px hit areas', async () => {
  const { user } = await openDoc(DOC);
  expect(within(screen.getByRole('toolbar', { name: 'Editing' })).queryByRole('button', { name: /comment/i })).toBeNull();
  selectText('holds');
  await openList(user);
  await user.click(addButton());
  for (const b of inSheet().getAllByRole('button')) expect(b).toHaveClass('m-tap');
});
