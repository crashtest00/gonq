import { render, screen } from '@testing-library/react';
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
  return {
    ...actual,
    setThreadStatus: (...args: Parameters<typeof actual.setThreadStatus>) => {
      if (refuse.on) {
        throw new Error(`Ambiguous thread reference ${JSON.stringify(args[1].id)}: 2 blocks carry that id.`);
      }
      return actual.setThreadStatus(...args);
    },
  };
});

afterEach(() => {
  refuse.on = false;
});

const A = 'c20260910143022a3f9c1';
const DOC = `Para one [💬](#md-thread-${A}) here.\n\n<!--\n@thread ${A}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nFirst?\n-->\n`;

async function openDoc(text: string) {
  const saved: string[] = [];
  const files: FileAccess = {
    pickDocument: async () => ({ name: 'a.md', path: '/d/a.md', text }),
    loadImage: async () => null,
    saveDocument: async (d) => {
      saved.push(d.text);
      return { name: d.name, path: d.path };
    },
    saveDocumentAs: async (d) => ({ name: d.name, path: null }),
  };
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
  await screen.findByTestId('markdown-view');
  return { user, saved };
}

async function setup() {
  const env = await openDoc(DOC);
  await env.user.click(screen.getByRole('button', { name: 'Comments' }));
  await env.user.click(await screen.findByRole('button', { name: /First\?/ }));
  return env;
}

async function save(user: ReturnType<typeof userEvent.setup>, saved: string[]) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  return saved[saved.length - 1];
}

describe('resolve and reopen', () => {
  test('Resolve swaps the badge, button and marker glyph; Reopen reverts', async () => {
    const { user, saved } = await setup();
    const view = screen.getByTestId('markdown-view');
    expect(view.textContent).toContain('💬');
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reopen' })).toBeInTheDocument();
    expect(view.textContent).toContain('✅');
    expect(view.textContent).not.toContain('💬');
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
    const resolved = await save(user, saved);
    expect(parseCommentThreads(resolved)[0].status).toBe('resolved');
    expect(resolved).toContain('✅');

    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(view.textContent).toContain('💬');
    const reopened = await save(user, saved);
    expect(reopened).toBe(DOC);
  });

  test('the list badge, thread-view badge and canvas glyph change together', async () => {
    const { user } = await setup();
    const view = screen.getByTestId('markdown-view');
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(view.textContent).toContain('✅');
    await user.click(screen.getByRole('button', { name: 'Close thread' }));
    const row = await screen.findByRole('button', { name: /First\?/ });
    expect(row.textContent).toContain('Resolved');
    expect(row.textContent).not.toContain('Open');
    await user.click(row);
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await user.click(screen.getByRole('button', { name: 'Close thread' }));
    expect((await screen.findByRole('button', { name: /First\?/ })).textContent).toContain('Open');
    expect(view.textContent).toContain('💬');
  });

  test('a draft in the reply box survives Resolve and is not saved', async () => {
    const { user, saved } = await setup();
    const box = () => screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement;
    await user.type(box(), 'half-typed');
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(box().value).toBe('half-typed');
    const text = await save(user, saved);
    expect(text).not.toContain('half-typed');
    expect(parseCommentThreads(text)[0].messages).toHaveLength(1);
  });

  test('a reply on a resolved thread is appended and the status stays resolved', async () => {
    const { user, saved } = await setup();
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    await user.type(screen.getByRole('textbox', { name: 'Reply' }), 'Late note');
    await user.click(screen.getByRole('button', { name: 'Reply' }));
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    const text = await save(user, saved);
    const [thread] = parseCommentThreads(text);
    expect(thread.status).toBe('resolved');
    expect(thread.messages.map((m) => m.body)).toEqual(['First?', 'Late note']);
    expect(text).toContain('✅');
  });

  test('one Undo reverts a Resolve, and one Undo reverts a Reopen, byte-exact', async () => {
    const { user, saved } = await setup();
    const undo = async () => {
      await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
      await user.click(await screen.findByRole('menuitem', { name: /Undo/ }));
    };
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    const resolved = await save(user, saved);
    await undo();
    expect(await save(user, saved)).toBe(DOC);
    expect(screen.getByTestId('markdown-view').textContent).toContain('💬');

    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    await undo();
    expect(await save(user, saved)).toBe(resolved);
    expect(screen.getByTestId('markdown-view').textContent).toContain('✅');
    expect(screen.getByText('Resolved')).toBeInTheDocument();
  });
});

describe('resolve edge cases', () => {
  const B = 'c20260910143022a3f9c2';
  const blk = (id: string, status: string, body: string) =>
    `<!--\n@thread ${id}\n@status ${status}\n\n[User | 2026-09-10T14:30:22+02:00]\n${body}\n-->`;

  test('E1: duplicate ids are paired by ordinal', async () => {
    const doc = `One [💬](#md-thread-${A}) two [💬](#md-thread-${A}).\n\n${blk(A, 'open', 'First?')}\n\n${blk(A, 'open', 'Second?')}\n`;
    const { user, saved } = await openDoc(doc);
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    await user.click(await screen.findByRole('button', { name: /Second\?/ }));
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    const text = await save(user, saved);
    expect(parseCommentThreads(text).map((t) => t.status)).toEqual(['open', 'resolved']);
    expect(text.match(/✅/g)).toHaveLength(1);
    expect(text.match(/💬/g)).toHaveLength(1);
  });

  test('E1: when the library throws (ambiguous id), the error is shown and the document is unchanged', async () => {
    const { user, saved } = await openDoc(DOC);
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    await user.click(await screen.findByRole('button', { name: /First\?/ }));
    refuse.on = true;
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByRole('alert').textContent).toMatch(/Ambiguous thread reference/);
    expect(screen.getByText('Open')).toBeInTheDocument();
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
    expect(screen.getByTestId('markdown-view').textContent).toContain('💬');
    expect(await save(user, saved)).toBe(DOC);
  });

  test('E2: a missing marker changes the status in the block only', async () => {
    const doc = `Para one here.\n\n${blk(A, 'open', 'First?')}\n`;
    const { user, saved } = await openDoc(doc);
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    await user.click(await screen.findByRole('button', { name: /First\?/ }));
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(screen.getByText('Resolved')).toBeInTheDocument();
    expect(await save(user, saved)).toBe(doc.replace('@status open', '@status resolved'));
  });

  test('E3: ✅ on an open thread is shown as written; Resolve and Reopen normalise it', async () => {
    const doc = `Para [✅](#md-thread-${A}) here.\n\n${blk(A, 'open', 'First?')}\n`;
    const { user, saved } = await openDoc(doc);
    expect(screen.getByTestId('markdown-view').textContent).toContain('✅');
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    await user.click(await screen.findByRole('button', { name: /First\?/ }));
    expect(screen.getByText('Open')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Resolve' }));
    expect(await save(user, saved)).toBe(doc.replace('@status open', '@status resolved'));
    await user.click(screen.getByRole('button', { name: 'Reopen' }));
    expect(await save(user, saved)).toBe(doc.replace('✅', '💬'));
    expect(screen.getByTestId('markdown-view').textContent).toContain('💬');
  });
});
