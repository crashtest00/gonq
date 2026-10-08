import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import { parseCommentThreads } from '../comment-threads';
import type { FileAccess } from '../platform/files';

vi.setConfig({ testTimeout: 30000 });

const A = 'c20260910143022a3f9c1';
const DOC = `Para one [💬](#md-thread-${A}) here.\n\n<!--\n@thread ${A}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nFirst?\n\n[bot | 2026-09-10T14:31:00+02:00]\nAnswer.\n-->\n`;

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
    expect(screen.getByText('Reworded')).toBeInTheDocument();
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
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.getByText('Answer.')).toBeInTheDocument();
    expect(await save(user, saved)).toBe(DOC);
  });

  test('confirmed Delete removes block and marker and returns to the list', async () => {
    const { user, saved } = await setup();
    await user.click(screen.getByRole('button', { name: 'Delete thread' }));
    await user.click(screen.getByRole('button', { name: 'Delete' }));
    expect(await screen.findByText('No comments yet.')).toBeInTheDocument();
    expect(screen.getByTestId('markdown-view').textContent).not.toContain('💬');
    const text = await save(user, saved);
    expect(parseCommentThreads(text)).toHaveLength(0);
    expect(text).not.toContain('md-thread');
    expect(text).not.toContain('<!--');
    expect(text).toContain('Para one');
  });
});
