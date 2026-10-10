import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import { AGENT_GUIDANCE, AGENT_GUIDANCE_TITLE, parseCommentThreads } from '../comment-threads';
import type { FileAccess } from '../platform/files';

vi.setConfig({ testTimeout: 30000 });

const A = 'c20260910143022a3f9c1';
const block = (id: string, author: string, body: string) =>
  `<!--\n@thread ${id}\n@status open\n\n[${author} | 2026-09-10T14:30:22+02:00]\n${body}\n-->`;
const WITH_THREAD = `Para one [💬](#md-thread-${A}) here.\n\n${block(A, 'User', 'First?')}\n`;
const NO_MARKER = `Para one here.\n\n${block(A, 'User', 'First?')}\n`;
const guidanceCount = (t: string) => t.split(AGENT_GUIDANCE_TITLE).length - 1;

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
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  await screen.findByTestId('markdown-view');
  return { user, saved };
}

async function save(user: ReturnType<typeof userEvent.setup>, saved: string[]) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  return saved[saved.length - 1];
}

async function openThread(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('button', { name: 'Comments' }));
  await user.click(await screen.findByRole('button', { name: /First\?/ }));
}

const reply = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByRole('textbox', { name: 'Reply' }), text);
  await user.click(screen.getByRole('button', { name: 'Reply' }));
};

describe('replying', () => {
  test('appends a [User | timestamp] message at the bottom, marks dirty, saves', async () => {
    const { user, saved } = await openDoc(WITH_THREAD);
    await openThread(user);
    await reply(user, 'Thanks');
    const items = screen.getAllByRole('listitem').filter((li) => li.textContent?.includes('·'));
    expect(items[items.length - 1].textContent).toContain('Thanks');
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
    expect((screen.getByRole('textbox', { name: 'Reply' }) as HTMLTextAreaElement).value).toBe('');
    const text = await save(user, saved);
    expect(text).toMatch(/\[User \| \d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d\]\nThanks\n-->/);
    expect(parseCommentThreads(text)[0].messages.map((m) => m.body)).toEqual(['First?', 'Thanks']);
    expect(guidanceCount(text)).toBe(0);
  });

  test('blank reply does nothing', async () => {
    const { user } = await openDoc(WITH_THREAD);
    await openThread(user);
    await reply(user, '   ');
    expect(screen.queryByLabelText('unsaved changes')).toBeNull();
  });

  test('undo removes the reply', async () => {
    const { user, saved } = await openDoc(WITH_THREAD);
    await openThread(user);
    await reply(user, 'Thanks');
    await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
    await user.click(await screen.findByRole('menuitem', { name: /Undo/ }));
    expect(await save(user, saved)).toBe(WITH_THREAD);
  });

  test('a reply containing --> round-trips', async () => {
    const { user, saved } = await openDoc(WITH_THREAD);
    await openThread(user);
    await reply(user, 'a --> b');
    const text = await save(user, saved);
    expect(parseCommentThreads(text)[0].messages[1].body).toBe('a --> b');
    expect(screen.getByText('a --> b')).toBeInTheDocument();
  });

  test('an agent message shows its own signature', async () => {
    const { user } = await openDoc(`${WITH_THREAD}\n`.replace('First?\n-->', 'First?\n\n[claude:7 | 2026-09-10T14:31:05+02:00]\nAnswer\n-->'));
    await openThread(user);
    expect(screen.getByText('claude:7')).toBeInTheDocument();
    expect(screen.queryByText('You')).toBeNull();
  });

  test('replies to a thread whose marker is missing', async () => {
    const { user, saved } = await openDoc(NO_MARKER);
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    await user.click(await screen.findByRole('button', { name: /First\?/ }));
    await reply(user, 'Still here');
    const text = await save(user, saved);
    expect(parseCommentThreads(text)[0].messages.map((m) => m.body)).toEqual(['First?', 'Still here']);
  });
});

describe('agent guidance', () => {
  async function createThread(text: string) {
    const env = await openDoc(text);
    await env.user.click(screen.getByRole('button', { name: 'Comments' }));
    const p = screen.getByText(/Hello/);
    const range = document.createRange();
    range.setStart(p.firstChild!, 0);
    range.setEnd(p.firstChild!, 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await env.user.click(await screen.findByRole('button', { name: 'Comment on selection' }));
    await env.user.type(screen.getByRole('textbox', { name: 'Comment' }), 'Note');
    await env.user.click(screen.getByRole('button', { name: 'Submit' }));
    return env;
  }

  test('written once with the first thread, not parsed as a thread, not rendered', async () => {
    const { user, saved } = await createThread('Hello world.\n');
    const text = await save(user, saved);
    expect(guidanceCount(text)).toBe(1);
    expect(text).toContain(AGENT_GUIDANCE);
    expect(parseCommentThreads(text)).toHaveLength(1);
    expect(AGENT_GUIDANCE).not.toMatch(/^\s*@thread/m);
    expect(parseCommentThreads(AGENT_GUIDANCE)).toHaveLength(0);
    expect(AGENT_GUIDANCE).not.toMatch(/-->(?!$)/);
    expect(screen.getByTestId('markdown-view').textContent).not.toContain('guidance for AI agents');
  });

  test('not duplicated when already present', async () => {
    const withGuidance = `Hello world.\n\n${AGENT_GUIDANCE}\n`;
    const a = await createThread(withGuidance);
    expect(guidanceCount(await save(a.user, a.saved))).toBe(1);
  });

  test('not added on reply alone', async () => {
    const { user, saved } = await openDoc(WITH_THREAD);
    await openThread(user);
    await reply(user, 'x');
    expect(guidanceCount(await save(user, saved))).toBe(0);
  });

  test('not added to a threadless file', async () => {
    const { user, saved } = await openDoc('Hello world.\n');
    expect(guidanceCount(await save(user, saved))).toBe(0);
  });
});
