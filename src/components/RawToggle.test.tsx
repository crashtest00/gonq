import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { docText, editorView, select, type as typeText, shownText } from '../testing/editor';
import App from '../App';
import type { FileAccess, OpenedDocument } from '../platform/files';

vi.setConfig({ testTimeout: 30000 });
vi.mock('../platform/lifecycle', () => ({ guardClose: () => () => {} }));

const ID = 'c20260910143022a3f9c1';
const THREAD = `<!--\n@thread ${ID}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nWhy?\n-->`;

// Unusual on purpose: nothing may be normalised by toggling.
const DOC =
  `# Title\n\nFirst para [💬](#md-thread-${ID}) here.\n\n*  odd item\n*  second\n\n- [ ] a task\n\n> quoted text\n\n` +
  '```js\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n![alt text](pic.png)\n\n' +
  THREAD +
  '\n';

function setup(text = DOC) {
  const doc: OpenedDocument = { name: 'a.md', path: '/d/a.md', text };
  const saveDocument = vi.fn(async (d: { name: string; path: string | null }) => ({ name: d.name, path: d.path }));
  const files: FileAccess = {
    pickDocument: async () => doc,
    saveDocument,
    saveDocumentAs: async (d) => ({ name: d.name, path: null }),
  };
  const user = userEvent.setup();
  render(<App files={files} />);
  return { user, saveDocument };
}

async function openDoc(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  await screen.findByTestId('editor');
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
}

const sw = () => screen.getByRole('switch', { name: /Raw Markdown/ });
const raw = () => document.querySelector('.cm-raw') !== null;

test('Raw shows the exact source in the same editor, Formatted hides the syntax again', async () => {
  const { user } = setup();
  await openDoc(user);
  const view = editorView();
  select(docText().length); // caret far from the first heading
  expect(sw()).toHaveAttribute('aria-checked', 'false');
  expect(raw()).toBe(false);
  expect(shownText().startsWith('Title')).toBe(true);

  await user.click(sw());
  expect(sw()).toHaveAttribute('aria-checked', 'true');
  expect(raw()).toBe(true);
  expect(editorView()).toBe(view); // one editor, not another one
  expect(shownText()).toBe(DOC.replace(/\n$/, '').replace(/\n/g, ''));
  expect(document.querySelectorAll('.cm-heading, .cm-strong, .cm-codeblock')).toHaveLength(0);

  await user.click(sw());
  expect(raw()).toBe(false);
  expect(shownText().startsWith('Title')).toBe(true);
});

test('an edit made in Raw is kept in Formatted and in the saved file', async () => {
  const { user, saveDocument } = setup('one two\n');
  await openDoc(user);
  await user.click(sw());
  select(3);
  typeText('!');
  expect(docText()).toBe('one! two\n');
  await user.click(sw());
  expect(docText()).toBe('one! two\n');
  await save(user);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: 'one! two\n' });
});

test('raw view shows thread markers literally, as Unicode glyphs', async () => {
  const { user } = setup(`Resolved [✅](#md-thread-${ID}) text.\n\n${THREAD.replace('open', 'resolved')}\n`);
  await openDoc(user);
  await user.click(sw());
  expect(shownText()).toContain(`Resolved [✅](#md-thread-${ID}) text.`);
  expect(document.querySelector('.cm-content svg, .cm-content img')).toBeNull();
});

test('toggling without editing leaves the document byte-identical and clean', async () => {
  const { user, saveDocument } = setup();
  await openDoc(user);
  await user.click(sw());
  await user.click(sw());
  expect(screen.queryByLabelText('unsaved changes')).toBeNull();
  await save(user);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: DOC });
});

test('Undo and Redo work across the switch', async () => {
  const { user, saveDocument } = setup();
  await openDoc(user);
  await user.click(sw());
  select(0);
  typeText('!');
  expect(docText().startsWith('!# Title')).toBe(true);
  await user.click(screen.getByRole('button', { name: /Undo/ }));
  expect(docText()).toBe(DOC);
  await user.click(screen.getByRole('button', { name: /Redo/ }));
  expect(docText().startsWith('!# Title')).toBe(true);
  await save(user);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: `!${DOC}` });
});
