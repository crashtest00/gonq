/** Covers the mobile Comments sheet through renderMobileApp, porting ReplyThread, ResolveThread and CommentThreads: the top-bar button, one row per thread with its own badge and no counts, the empty text, Add comment, marker tap, Reply (format, blank, undo, -->, agent author, missing marker, guidance, Ctrl/Cmd+Enter once), Resolve/Reopen (badges, glyph, bytes, drafts, undo, duplicate ids, library error in the banner, missing marker, ✅), Close thread, the docked layout and 44px hit areas. */
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
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
const refuse = vi.hoisted(() => ({ on: false }));
vi.mock('@gonq/editor/comment-threads', async (importActual) => {
  const actual = await importActual<typeof import('@gonq/editor/comment-threads')>();
  return {
    ...actual,
    setThreadStatus: (...args: Parameters<typeof actual.setThreadStatus>) => {
      if (refuse.on) throw new Error(`Ambiguous thread reference ${JSON.stringify(args[1].id)}: 2 blocks carry that id.`);
      return actual.setThreadStatus(...args);
    },
  };
});

import { AGENT_GUIDANCE_TITLE, parseCommentThreads } from '@gonq/editor/comment-threads';
import { preview } from '@gonq/editor/model/threads';
import { settleEditors } from '@gonq/editor/testing/editor';
import { renderMobileApp, type User } from '../testing/renderMobileApp';

const A = 'c20260910143022a3f9c1';
const B = 'c20260910143022a3f9c2';
const blk = (id: string, status: string, body: string, anchor?: string) =>
  `<!--\n@thread ${id}\n@status ${status}\n${anchor ? `@anchor ${anchor}\n` : ''}\n[User | 2026-09-10T14:30:22+02:00]\n${body}\n-->`;
const DOC = `Para one [💬](#md-thread-${A}) here.\n\n${blk(A, 'open', 'First?')}\n`;
const NO_MARKER = `Para one here.\n\n${blk(A, 'open', 'First?')}\n`;

beforeEach(() => {
  refuse.on = false;
  disk.saved = [];
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve([{ path: '/d/a.md', opened_at: Date.now() }]);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    if (cmd === 'path_exists') return Promise.resolve(true);
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
const editor = () => document.querySelector<HTMLElement>('.cm-content')!;
const sheet = () => screen.getByRole('dialog', { name: 'Comments' });
const inSheet = () => within(sheet());

async function openList(user: User) {
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await screen.findByRole('dialog', { name: 'Comments' });
}
async function openThread(user: User, name: RegExp = /First\?/) {
  await openList(user);
  await user.click(await inSheet().findByRole('button', { name }));
}
async function save(user: User) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  await waitFor(() => expect(disk.saved.length).toBeGreaterThan(0));
  const text = disk.saved[disk.saved.length - 1];
  return text;
}
async function undo(user: User) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Undo' }));
}
const box = () => screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
async function reply(user: User, text: string) {
  await user.type(box(), text);
  await user.click(screen.getByRole('button', { name: 'Reply' }));
}

it('the top-bar Comments button opens a list: one row per thread, own badge, no counts, Add comment', async () => {
  const doc = `A [💬](#md-thread-${A}) b [✅](#md-thread-${B}).\n\n${blk(A, 'open', 'Where from?', 'holds through Q3')}\n\n${blk(B, 'resolved', 'Second thread body that is definitely longer than fifty characters in total.')}\n`;
  const { user } = await openDoc(doc);
  expect(screen.queryByRole('dialog', { name: 'Comments' })).toBeNull();
  await openList(user);
  const rows = inSheet().getAllByRole('listitem');
  expect(rows).toHaveLength(2);
  expect(rows[0].textContent).toContain('Open');
  expect(rows[0].textContent).toContain('holds through Q3');
  expect(rows[0].textContent).toContain('Where from?');
  expect(rows[1].textContent).toContain('Resolved');
  expect(rows[1].textContent).toContain(preview('Second thread body that is definitely longer than fifty characters in total.'));
  expect(sheet().textContent).not.toMatch(/\d+\s*(open|resolved)/i);
  expect(inSheet().getByRole('button', { name: 'Add comment' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  expect(screen.queryByRole('dialog', { name: 'Comments' })).toBeNull();
});

it('shows "No comments yet." for a document without threads', async () => {
  const { user } = await openDoc('Hello world.\n');
  await openList(user);
  expect(inSheet().getByText('No comments yet.')).toBeInTheDocument();
});

it('tapping a comment marker opens its thread', async () => {
  const doc = `A [💬](#md-thread-${A}) b [✅](#md-thread-${B}).\n\n${blk(A, 'open', 'First?')}\n\n${blk(B, 'resolved', 'Second body')}\n`;
  const { user } = await openDoc(doc);
  await waitFor(() => expect(editor().querySelectorAll('.cm-thread-marker')).toHaveLength(2));
  await user.click(editor().querySelectorAll('.cm-thread-marker')[1]);
  expect(await inSheet().findByRole('button', { name: 'Close thread' })).toBeInTheDocument();
  expect(inSheet().getByText('Second body')).toBeInTheDocument();
  await user.click(inSheet().getByRole('button', { name: 'Close thread' }));
  expect(inSheet().getAllByRole('listitem')).toHaveLength(2);
});

it('the sheet is docked (no scrim, not modal) and its controls have 44px hit areas', async () => {
  const { user } = await openDoc(DOC);
  await openThread(user);
  expect(sheet()).toHaveAttribute('aria-modal', 'false');
  expect(screen.queryByRole('button', { name: 'Close sheet' })).toBeNull();
  for (const b of inSheet().getAllByRole('button')) expect(b).toHaveClass('m-tap');
  expect(screen.getByRole('button', { name: 'Comments' })).toHaveClass('m-tap');
});

it('closes with Close; the Comments button reopens at the list', async () => {
  const { user } = await openDoc(DOC);
  await openThread(user);
  await user.click(inSheet().getByRole('button', { name: 'Close' }));
  expect(screen.queryByRole('dialog', { name: 'Comments' })).toBeNull();
  await openList(user);
  expect(inSheet().queryByRole('button', { name: 'Close thread' })).toBeNull();
});

describe('replying', () => {
  it('appends a [User | timestamp] message at the bottom, clears the box, saves', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    await reply(user, 'Thanks');
    const items = inSheet().getAllByRole('listitem').filter((li) => li.textContent?.includes('·'));
    expect(items[items.length - 1].textContent).toContain('Thanks');
    expect(box().value).toBe('');
    const text = await save(user);
    expect(text).toMatch(/\[User \| \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d\]\nThanks\n-->/);
    expect(parseCommentThreads(text)[0].messages.map((m) => m.body)).toEqual(['First?', 'Thanks']);
    expect(text.split(AGENT_GUIDANCE_TITLE).length - 1).toBe(0);
  });

  it('a blank reply does nothing', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    await reply(user, '   ');
    expect(await save(user)).toBe(DOC);
  });

  it('undo removes the reply', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    await reply(user, 'Thanks');
    await undo(user);
    expect(await save(user)).toBe(DOC);
  });

  it('a reply containing --> round-trips', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    await reply(user, 'a --> b');
    expect(parseCommentThreads(await save(user))[0].messages[1].body).toBe('a --> b');
    expect(inSheet().getByText('a --> b')).toBeInTheDocument();
  });

  it('an agent message shows its own signature', async () => {
    const { user } = await openDoc(DOC.replace('First?\n-->', 'First?\n\n[claude:7 | 2026-09-10T14:31:05+02:00]\nAnswer\n-->'));
    await openThread(user);
    expect(inSheet().getByText('claude:7')).toBeInTheDocument();
    expect(inSheet().queryByText('You')).toBeNull();
  });

  it('replies to a thread whose marker is missing', async () => {
    const { user } = await openDoc(NO_MARKER);
    await openThread(user);
    await reply(user, 'Still here');
    expect(parseCommentThreads(await save(user))[0].messages.map((m) => m.body)).toEqual(['First?', 'Still here']);
  });

  it('Ctrl+Enter and Cmd+Enter save once; repeat and IME composition do not; hints are on the box and button', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    expect(box()).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    expect(box().title).toContain('Ctrl+Enter');
    const button = screen.getByRole('button', { name: 'Reply' });
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Control+Enter Meta+Enter');
    expect(button.title).toContain('Cmd+Enter');
    await user.type(box(), 'one');
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, repeat: true });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true, isComposing: true });
    expect(box().value).toBe('one');
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    fireEvent.keyDown(box(), { key: 'Enter', ctrlKey: true });
    expect(box().value).toBe('');
    await user.type(box(), 'two');
    fireEvent.keyDown(box(), { key: 'Enter', metaKey: true });
    expect(parseCommentThreads(await save(user))[0].messages.map((m) => m.body)).toEqual(['First?', 'one', 'two']);
  });
});

describe('resolve and reopen', () => {
  it('Resolve swaps badge, button and marker glyph; Reopen reverts byte-exact', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    expect(editor().textContent).toContain('💬');
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(inSheet().getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(editor().textContent).toContain('✅');
    expect(editor().textContent).not.toContain('💬');
    const resolved = await save(user);
    expect(parseCommentThreads(resolved)[0].status).toBe('resolved');
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(inSheet().getByText('Open')).toBeInTheDocument();
    expect(editor().textContent).toContain('💬');
    expect(await save(user)).toBe(DOC);
  });

  it('the list badge and thread badge change together; Close thread returns to the list', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    await user.click(inSheet().getByRole('button', { name: 'Close thread' }));
    const row = await inSheet().findByRole('button', { name: /First\?/ });
    expect(row.textContent).toContain('Resolved');
    expect(row.textContent).not.toContain('Open');
    await user.click(row);
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await user.click(inSheet().getByRole('button', { name: 'Close thread' }));
    expect((await inSheet().findByRole('button', { name: /First\?/ })).textContent).toContain('Open');
  });

  it('a draft in the reply box survives Resolve and is not saved', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    await user.type(box(), 'half-typed');
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(box().value).toBe('half-typed');
    const text = await save(user);
    expect(text).not.toContain('half-typed');
    expect(parseCommentThreads(text)[0].messages).toHaveLength(1);
  });

  it('a reply on a resolved thread is appended and the status stays resolved', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    await reply(user, 'Late note');
    const text = await save(user);
    const [thread] = parseCommentThreads(text);
    expect(thread.status).toBe('resolved');
    expect(thread.messages.map((m) => m.body)).toEqual(['First?', 'Late note']);
    expect(text).toContain('✅');
  });

  it('one Undo reverts a Resolve, one Undo reverts a Reopen, byte-exact', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    const resolved = await save(user);
    await undo(user);
    expect(await save(user)).toBe(DOC);
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await undo(user);
    expect(await save(user)).toBe(resolved);
  });

  it('duplicate ids are paired by ordinal', async () => {
    const doc = `One [💬](#md-thread-${A}) two [💬](#md-thread-${A}).\n\n${blk(A, 'open', 'First?')}\n\n${blk(A, 'open', 'Second?')}\n`;
    const { user } = await openDoc(doc);
    await openThread(user, /Second\?/);
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    const text = await save(user);
    expect(parseCommentThreads(text).map((t) => t.status)).toEqual(['open', 'resolved']);
    expect(text.match(/✅/g)).toHaveLength(1);
    expect(text.match(/💬/g)).toHaveLength(1);
  });

  it('when the library throws (ambiguous id) the banner shows the error and the document is unchanged', async () => {
    const { user } = await openDoc(DOC);
    await openThread(user);
    refuse.on = true;
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Ambiguous thread reference/);
    expect(inSheet().getByText('Open')).toBeInTheDocument();
    expect(editor().textContent).toContain('💬');
    expect(await save(user)).toBe(DOC);
  });

  it('a missing marker changes the status in the block only', async () => {
    const { user } = await openDoc(NO_MARKER);
    await openThread(user);
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await save(user)).toBe(NO_MARKER.replace('@status open', '@status resolved'));
  });

  it('✅ on an open thread is shown as written; Resolve and Reopen normalise it', async () => {
    const doc = `Para [✅](#md-thread-${A}) here.\n\n${blk(A, 'open', 'First?')}\n`;
    const { user } = await openDoc(doc);
    expect(editor().textContent).toContain('✅');
    await openThread(user);
    expect(inSheet().getByText('Open')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await save(user)).toBe(doc.replace('@status open', '@status resolved'));
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await save(user)).toBe(doc.replace('✅', '💬'));
  });
});
