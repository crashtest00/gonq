import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import { parseCommentThreads } from '../comment-threads';
import type { FileAccess } from '../platform/files';

vi.setConfig({ testTimeout: 30000 });

// Lets one test make the library refuse the edit, as it does for an ambiguous id.
const refuse = vi.hoisted(() => ({ on: false }));
vi.mock('../comment-threads', async (importActual) => {
  const actual = await importActual<typeof import('../comment-threads')>();
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

afterEach(() => {
  refuse.on = false;
});

const A = 'c20260910143022a3f9c1';
const DOC = `Para one [💬](#md-thread-${A}) here.\n\n<!--\n@thread ${A}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nFirst?\n\n[bot | 2026-09-10T14:31:00+02:00]\nAnswer.\n-->\n`;

async function openDoc(text: string) {
  const saved: string[] = [];
  const files: FileAccess = {
    pickDocument: async () => ({ name: 'a.md', path: '/d/a.md', text }),
    saveDocument: async (d) => {
      saved.push(d.text);
      return { name: d.name, path: d.path };
    },
    saveDocumentAs: async (d) => ({ name: d.name, path: null }),
  };
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  await screen.findByTestId('editor');
  return { user, saved };
}

async function setup() {
  const env = await openDoc(DOC);
  await env.user.click(screen.getByRole('button', { name: 'Comments' }));
  await env.user.click(await screen.findByRole('button', { name: /First\?/ }));
  return env;
}

const inSidebar = () => within(screen.getByRole('complementary', { name: 'Comments' }));

async function save(user: ReturnType<typeof userEvent.setup>, saved: string[]) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  return saved[saved.length - 1];
}

describe('edit and delete', () => {
  test('Save replaces only the first message', async () => {
    const { user, saved } = await setup();
    await user.click(screen.getByRole('button', { name: 'Edit thread' }));
    const box = screen.getByRole('textbox', { name: 'Edit comment' }) as HTMLTextAreaElement;
    expect(box.value).toBe('First?');
    await user.clear(box);
    await user.type(box, 'Reworded');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.queryByRole('textbox', { name: 'Edit comment' })).toBeNull();
    expect(inSidebar().getByText('Reworded')).toBeInTheDocument();
    const [first, second] = parseCommentThreads(await save(user, saved))[0].messages;
    expect(first.body).toBe('Reworded');
    expect(first.author).toBe('User');
    expect(second.body).toBe('Answer.');
  });

  test('Save on blank input does nothing; Cancel discards', async () => {
    const { user, saved } = await setup();
    await user.click(screen.getByRole('button', { name: 'Edit thread' }));
    const box = screen.getByRole('textbox', { name: 'Edit comment' });
    await user.clear(box);
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('textbox', { name: 'Edit comment' })).toBeInTheDocument();
    await user.type(box, 'zzz');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('textbox', { name: 'Edit comment' })).toBeNull();
    expect(await save(user, saved)).toBe(DOC);
  });

  test('Delete asks first; Cancel keeps the thread', async () => {
    const { user, saved } = await setup();
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(inSidebar().getByText('Answer.')).toBeInTheDocument();
    expect(await save(user, saved)).toBe(DOC);
  });

  test('confirmed Delete removes block and marker and returns to the list', async () => {
    const { user, saved } = await setup();
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No comments yet.')).toBeInTheDocument();
    expect(screen.getByTestId('editor').textContent).not.toContain('💬');
    const text = await save(user, saved);
    expect(parseCommentThreads(text)).toHaveLength(0);
    expect(text).not.toContain('md-thread');
    expect(text).not.toContain('<!--');
    expect(text).toContain('Para one');
  });
});

const B = 'c20260910143022a3f9c2';
const blk = (id: string, body: string, author = 'User', stamp = '2026-09-10T14:30:22+02:00') =>
  `<!--\n@thread ${id}\n@status open\n\n[${author} | ${stamp}]\n${body}\n-->`;

type U = ReturnType<typeof userEvent.setup>;
async function undo(user: U) {
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
  await user.click(await screen.findByRole('menuitem', { name: /Undo/ }));
}
async function openThread(user: U, name: RegExp) {
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(await screen.findByRole('button', { name }));
}
async function editFirst(user: U, text: string) {
  await user.click(screen.getByRole('button', { name: 'Edit thread' }));
  const box = screen.getByRole('textbox', { name: 'Edit comment' });
  await user.clear(box);
  if (text !== '') await user.type(box, text);
  return box;
}

describe('edit', () => {
  test('changes only the first message body: full saved text, author, timestamp, other messages and marker intact', async () => {
    const { user, saved } = await setup();
    await editFirst(user, 'Reworded');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await save(user, saved)).toBe(DOC.replace('First?', 'Reworded'));
  });

  test('whitespace-only text does nothing', async () => {
    const { user, saved } = await setup();
    await editFirst(user, '');
    await user.type(screen.getByRole('textbox', { name: 'Edit comment' }), '   ');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('textbox', { name: 'Edit comment' })).toBeInTheDocument();
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(await save(user, saved)).toBe(DOC);
  });

  test('the unsaved indicator appears after an edit', async () => {
    const { user } = await setup();
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
    await editFirst(user, 'Reworded');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
  });

  test('one Undo restores the edit, byte-exact', async () => {
    const { user, saved } = await setup();
    await editFirst(user, 'Reworded');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    await undo(user);
    expect(await save(user, saved)).toBe(DOC);
    expect(inSidebar().getByText('First?')).toBeInTheDocument();
  });

  test('text containing --> round-trips', async () => {
    const { user, saved } = await setup();
    await editFirst(user, 'a --> b');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    const text = await save(user, saved);
    const [thread] = parseCommentThreads(text);
    expect(thread.messages[0].body).toBe('a --> b');
    expect(thread.messages[1].body).toBe('Answer.');
    expect(parseCommentThreads(text)).toHaveLength(1);
  });

  test('an agent-authored first message can be edited and keeps its author', async () => {
    const stamp = '2026-09-10T14:30:22+02:00';
    const doc = `Para [💬](#md-thread-${A}) here.\n\n${blk(A, 'Agent says', 'architect-agent:75a079f6', stamp)}\n`;
    const { user, saved } = await openDoc(doc);
    await openThread(user, /Agent says/);
    await editFirst(user, 'Agent revised');
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(await save(user, saved)).toBe(doc.replace('Agent says', 'Agent revised'));
    expect(parseCommentThreads(saved[saved.length - 1])[0].messages[0].author).toBe('architect-agent:75a079f6');
  });

  test('an ambiguous id shows an error and changes nothing', async () => {
    const { user, saved } = await setup();
    await editFirst(user, 'Reworded');
    refuse.on = true;
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Ambiguous thread reference/);
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
    expect(await save(user, saved)).toBe(DOC);
  });
});

describe('delete', () => {
  const TWO = `One [💬](#md-thread-${A}) two [💬](#md-thread-${B}).\n\n${blk(A, 'First?')}\n\n${blk(B, 'Second?')}\n`;

  async function twoThreads() {
    const env = await openDoc(TWO);
    await openThread(env.user, /First\?/);
    return env;
  }

  test('the dialog names the thread, and Cancel is the default focus', async () => {
    const { user } = await twoThreads();
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog.textContent).toContain('First?');
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
  });

  test('Escape cancels and changes nothing', async () => {
    const { user, saved } = await twoThreads();
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));
    await screen.findByRole('alertdialog');
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
    expect(await save(user, saved)).toBe(TWO);
  });

  test('deleting one of two threads leaves the other; the list shows only it; unsaved shows', async () => {
    const { user, saved } = await twoThreads();
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await screen.findByRole('heading', { name: 'Comments' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /First\?/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Second\?/ })).toBeInTheDocument();
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
    const text = await save(user, saved);
    expect(parseCommentThreads(text).map((t) => t.id)).toEqual([B]);
    expect(text).not.toContain(`md-thread-${A}`);
    expect(text).toContain(`md-thread-${B}`);
    expect(text).toContain(blk(B, 'Second?'));
  });

  test('one Undo restores the deleted thread, block and marker, byte-exact', async () => {
    const { user, saved } = await twoThreads();
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    await undo(user);
    expect(await save(user, saved)).toBe(TWO);
    expect(screen.getByTestId('editor').textContent?.match(/💬/g)).toHaveLength(2);
  });

  test('a thread with no marker is deleted by block', async () => {
    const doc = `Para here.\n\n${blk(A, 'First?')}\n`;
    const { user, saved } = await openDoc(doc);
    await openThread(user, /First\?/);
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(await save(user, saved)).toBe('Para here.\n');
  });

  test('an ambiguous id shows an error and changes nothing', async () => {
    const { user, saved } = await twoThreads();
    refuse.on = true;
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));
    await user.click(await screen.findByRole('button', { name: 'Delete' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Ambiguous thread reference/);
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
    expect(await save(user, saved)).toBe(TWO);
  });
});

describe('reading', () => {
  test('opening a file and viewing a thread never modifies it', async () => {
    const { user, saved } = await setup();
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Edit thread' }));
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
    expect(saved).toHaveLength(0);
  });
});
