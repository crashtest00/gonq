/** Covers editing a thread's first message and deleting a thread (block and marker) in the mobile Comments sheet through renderMobileApp, porting EditDeleteThread: Edit thread replaces only the first message (blank does nothing, Cancel discards, undo), Delete thread asks first (Cancel keeps it, confirm removes block and marker and returns to the list), library errors go to the banner, and the buttons have 44px hit areas. */
import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

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
const refuse = vi.hoisted(() => ({ on: false }));
vi.mock('@gonq/editor/comment-threads', async (importActual) => {
  const actual = await importActual<typeof import('@gonq/editor/comment-threads')>();
  const ambiguous = (id: string) => new Error(`Ambiguous thread reference ${JSON.stringify(id)}: 2 blocks carry that id.`);
  return {
    ...actual,
    editThreadMessage: (...args: Parameters<typeof actual.editThreadMessage>) => {
      if (refuse.on) throw ambiguous(args[1].id);
      return actual.editThreadMessage(...args);
    },
    deleteThread: (...args: Parameters<typeof actual.deleteThread>) => {
      if (refuse.on) throw ambiguous(args[1].id);
      return actual.deleteThread(...args);
    },
  };
});

import { parseCommentThreads } from '@gonq/editor/comment-threads';
import { settleEditors } from '@gonq/editor/testing/editor';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

afterEach(() => {
  refuse.on = false;
});

const A = 'c20260910143022a3f9c1';
const DOC = `Para one [💬](#md-thread-${A}) here.\n\n<!--\n@thread ${A}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nFirst?\n\n[bot | 2026-09-10T14:31:00+02:00]\nAnswer.\n-->\n`;

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

async function setup() {
  const env = await openDoc(DOC);
  await openList(env.user);
  await env.user.click(await inSheet().findByRole('button', { name: /First\?/ }));
  return env;
}
const editBox = () => screen.queryByRole('textbox', { name: 'Edit comment' }) as HTMLTextAreaElement | null;
async function editFirst(user: User, text: string) {
  await user.click(inSheet().getByRole('button', { name: 'Edit thread' }));
  const box = editBox()!;
  await user.clear(box);
  if (text !== '') await user.type(box, text);
}

it('Edit thread: Save replaces only the first message, keeping author, timestamp, other messages and marker', async () => {
  const { user } = await setup();
  await user.click(inSheet().getByRole('button', { name: 'Edit thread' }));
  expect(editBox()!.value).toBe('First?');
  expect(inSheet().getByRole('button', { name: 'Edit thread' })).toBeDisabled();
  await user.clear(editBox()!);
  await user.type(editBox()!, 'Reworded');
  await user.click(inSheet().getByRole('button', { name: 'Save' }));
  expect(editBox()).toBeNull();
  expect(inSheet().getByText('Reworded')).toBeInTheDocument();
  const text = await save(user);
  expect(text).toBe(DOC.replace('First?', 'Reworded'));
  const [first, second] = parseCommentThreads(text)[0].messages;
  expect(first).toMatchObject({ author: 'User', body: 'Reworded' });
  expect(second.body).toBe('Answer.');
});

it('Save on blank input does nothing; Cancel discards', async () => {
  const { user } = await setup();
  await editFirst(user, '');
  await user.type(editBox()!, '   ');
  await user.click(inSheet().getByRole('button', { name: 'Save' }));
  expect(editBox()).not.toBeNull();
  await user.click(inSheet().getByRole('button', { name: 'Cancel' }));
  expect(editBox()).toBeNull();
  expect(await save(user)).toBe(DOC);
});

it('an edit is undone in one step', async () => {
  const { user } = await setup();
  await editFirst(user, 'Reworded');
  await user.click(inSheet().getByRole('button', { name: 'Save' }));
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Undo' }));
  expect(await save(user)).toBe(DOC);
});

it('Delete thread asks first, with the desktop wording; Cancel keeps the thread', async () => {
  const { user } = await setup();
  await user.click(inSheet().getByRole('button', { name: 'Delete thread' }));
  const ask = screen.getByRole('alertdialog');
  expect(within(ask).getByText('The whole thread, including its replies, is removed from the document.')).toBeInTheDocument();
  expect(within(ask).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await user.click(within(ask).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('alertdialog')).toBeNull();
  expect(inSheet().getByText('Answer.')).toBeInTheDocument();
  expect(await save(user)).toBe(DOC);
});

it('confirmed Delete removes block and marker and returns to the list', async () => {
  const { user } = await setup();
  await user.click(inSheet().getByRole('button', { name: 'Delete thread' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  expect(await inSheet().findByText('No comments yet.')).toBeInTheDocument();
  expect(document.querySelector('.cm-content')!.textContent).not.toContain('💬');
  const text = await save(user);
  expect(parseCommentThreads(text)).toHaveLength(0);
  expect(text).not.toContain('md-thread');
  expect(text).not.toContain('<!--');
  expect(text).toContain('Para one');
});

it('a library refusal goes to the banner and leaves the thread and the document alone', async () => {
  const { user } = await setup();
  refuse.on = true;
  await user.click(inSheet().getByRole('button', { name: 'Delete thread' }));
  await user.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }));
  expect(await screen.findByText(/Ambiguous thread reference/)).toBeInTheDocument();
  expect(inSheet().getByText('Answer.')).toBeInTheDocument();
  await editFirst(user, 'x');
  await user.click(inSheet().getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(screen.getAllByText(/Ambiguous thread reference/).length).toBeGreaterThan(0));
  refuse.on = false;
  expect(await save(user)).toBe(DOC);
});

it('Edit, Delete and the edit box buttons have 44px hit areas', async () => {
  const { user } = await setup();
  for (const b of inSheet().getAllByRole('button')) expect(b).toHaveClass('m-tap');
  await user.click(inSheet().getByRole('button', { name: 'Edit thread' }));
  for (const b of inSheet().getAllByRole('button')) expect(b).toHaveClass('m-tap');
});
