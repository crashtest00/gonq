import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { activeBlocks, activeSource } from '../testing/inplace';
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
    loadImage: async () => null,
    saveDocument,
    saveDocumentAs: async (d) => ({ name: d.name, path: null }),
  };
  const user = userEvent.setup();
  render(<App files={files} />);
  return { user, saveDocument };
}

async function openDoc(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
  await screen.findByTestId('markdown-view');
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
}

const editors = () => screen.queryAllByRole('textbox', { name: /Markdown source/ }) as HTMLTextAreaElement[];
const sw = () => screen.getByRole('switch', { name: /Raw Markdown/ });

const BLOCKS: [string, () => HTMLElement | Promise<HTMLElement>, string][] = [
  ['heading', () => screen.getByRole('heading', { name: 'Title' }), '# Title'],
  ['paragraph', () => screen.getByText(/First para/), `First para [💬](#md-thread-${ID}) here.`],
  ['list', () => screen.getByText('odd item'), '*  odd item\n*  second'],
  ['task item', () => screen.getByText('a task'), '- [ ] a task'],
  ['blockquote', () => screen.getByText('quoted text'), '> quoted text'],
  ['code block', () => screen.getByText('const x = 1;'), '```js\nconst x = 1;\n```'],
  ['table', () => screen.getByRole('cell', { name: '1' }), '| a | b |\n|---|---|\n| 1 | 2 |'],
  ['image', () => screen.findByTestId('figure-placeholder'), '![alt text](pic.png)'],
];

// Tables are the one block still edited in a Markdown field; the rest stay formatted when clicked.
const IN_PLACE = BLOCKS.filter((b) => b[0] !== 'table');

test.each(IN_PLACE)('clicking a %s keeps it formatted, with its source in place; leaving returns to rest', async (_n, find, source) => {
  const { user } = setup();
  await openDoc(user);
  await user.click(await find());
  await waitFor(() => expect(activeBlocks()).toHaveLength(1));
  expect(editors()).toHaveLength(0);
  expect(activeSource().replace(/\r/g, '')).toBe(source.replace(`[💬](#md-thread-${ID})`, '💬'));
  await user.keyboard('{Escape}');
  expect(activeBlocks()).toHaveLength(0);
  expect(editors()).toHaveLength(0);
});

test('clicking a table edits it in place, never as pipe syntax; leaving returns to rest', async () => {
  const { user } = setup();
  await openDoc(user);
  await user.click(screen.getByRole('cell', { name: '1' }));
  await waitFor(() => expect(activeBlocks()).toHaveLength(1));
  expect(editors()).toHaveLength(0);
  expect(screen.getByRole('table')).toBeInTheDocument();
  await user.keyboard('{Escape}');
  expect(activeBlocks()).toHaveLength(0);
  expect(editors()).toHaveLength(0);
});

test('the footer switch forces every block raw, overriding per-block state, and off restores formatted', async () => {
  const { user } = setup();
  await openDoc(user);
  expect(sw()).toHaveAttribute('aria-checked', 'false');
  await user.click(screen.getByText('quoted text'));
  expect(activeBlocks()).toHaveLength(1);

  await user.click(sw());
  expect(sw()).toHaveAttribute('aria-checked', 'true');
  // Editing in place ends; every block is a field.
  expect(activeBlocks()).toHaveLength(0);
  expect(editors().map((e) => e.value)).toEqual(BLOCKS.map((b) => b[2]));
  // Clicking a raw block does not flip it back while the switch is on.
  await user.click(editors()[0]);
  expect(editors()).toHaveLength(BLOCKS.length);

  await user.click(sw());
  expect(editors()).toHaveLength(0);
  expect(screen.getByRole('heading', { name: 'Title' })).toBeInTheDocument();
});

test('raw view shows thread markers literally, as Unicode glyphs', async () => {
  const { user } = setup(`Resolved [✅](#md-thread-${ID}) text.\n\n${THREAD.replace('open', 'resolved')}\n`);
  await openDoc(user);
  await user.click(sw());
  expect(editors()[0].value).toBe(`Resolved [✅](#md-thread-${ID}) text.`);
  expect(document.querySelector('.gonq-marker svg, textarea svg')).toBeNull();
});

test('toggling without editing leaves the document byte-identical and clean', async () => {
  const { user, saveDocument } = setup();
  await openDoc(user);
  await user.click(screen.getByText('quoted text'));
  await user.keyboard('{Escape}');
  await user.click(sw());
  await user.click(sw());
  expect(screen.queryByText(/Unsaved|•/)).toBeNull();
  await save(user);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: DOC });
});

test('a raw edit in the document-wide view is undoable and redoable, and only splices its block', async () => {
  const { user, saveDocument } = setup();
  await openDoc(user);
  await user.click(sw());
  await user.type(editors()[0], '!');
  expect(editors()[0].value).toBe('# Title!');

  await user.click(screen.getByRole('button', { name: /Undo/ }));
  expect(editors()[0].value).toBe('# Title');
  await user.click(screen.getByRole('button', { name: /Redo/ }));
  expect(editors()[0].value).toBe('# Title!');

  await save(user);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: DOC.replace('# Title', '# Title!') });
});

test('a raw edit that splits a block renders as the resulting blocks; an unclosed fence loses no text', async () => {
  const { user, saveDocument } = setup('one two\n\nlast\n');
  await openDoc(user);
  await user.click(sw());
  await user.type(editors()[0], '{Enter}{Enter}```');
  await user.click(sw());
  await save(user);
  expect(saveDocument).toHaveBeenCalledWith({ name: 'a.md', path: '/d/a.md', text: 'one two\n\n```\n\nlast\n' });
});
