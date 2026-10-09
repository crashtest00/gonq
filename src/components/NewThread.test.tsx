import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import { isCommentableAt } from './newThread';
import { parseCommentThreads } from '../comment-threads';
import type { FileAccess, OpenedDocument } from '../platform/files';

vi.setConfig({ testTimeout: 30000 });

const ID = /c\d{14}[0-9a-f]{12}/;

function setup(text: string) {
  const saved: string[] = [];
  const doc: OpenedDocument = { name: 'a.md', path: '/d/a.md', text };
  const files: FileAccess = {
    pickDocument: async () => ({ ...doc, text: (saved.length ? saved[saved.length - 1] : text) }),
    loadImage: async () => null,
    saveDocument: async (d) => {
      saved.push(d.text);
      return { name: d.name, path: d.path };
    },
    saveDocumentAs: async (d) => ({ name: d.name, path: null }),
  };
  return { files, saved };
}

async function openFile(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
  await screen.findByTestId('markdown-view');
}

async function openDoc(text: string) {
  const user = userEvent.setup();
  const env = setup(text);
  render(<App files={env.files} />);
  await openFile(user);
  return { user, ...env };
}

/** Selects `needle` inside the element whose own text contains it. */
function select(container: HTMLElement, needle: string, end?: { node: Node; offset: number }) {
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const i = (n.textContent ?? '').indexOf(needle);
    if (i >= 0) {
      act(() => {
        window.getSelection()!.setBaseAndExtent(n, i, end?.node ?? n, end?.offset ?? i + needle.length);
        document.dispatchEvent(new Event('selectionchange'));
      });
      return n;
    }
  }
  throw new Error(`no text ${needle}`);
}

const view = () => screen.getByTestId('markdown-view');
const selButton = () => screen.queryByRole('button', { name: 'Comment on selection' });
const addButton = () => screen.getByRole('button', { name: 'Add comment' });

const DOC = [
  '# A heading',
  '',
  'The estimate holds through Q3 but not beyond.',
  '',
  '- [ ] first task item',
  '- [x] done task',
  '',
  '```',
  'code line here',
  '```',
  '',
  '| h1 | h2 |',
  '| -- | -- |',
  '| cell one | cell two |',
  '',
  'Second paragraph.',
  '',
].join('\n');

test('selection inside one paragraph shows the button; clicking opens the draft with the quoted anchor', async () => {
  const { user } = await openDoc(DOC);
  expect(selButton()).toBeNull();
  select(view(), 'holds through Q3');
  await user.click(selButton()!);
  const side = screen.getByRole('complementary', { name: 'Comments' });
  expect(within(side).getByText('New comment')).toBeInTheDocument();
  expect(side).toHaveTextContent("On: 'holds through Q3'");
  const box = within(side).getByRole('textbox');
  expect(box).toHaveFocus();
  expect(box).toHaveAttribute('rows', '4');
});

test('selection inside a task item shows the button', async () => {
  await openDoc(DOC);
  select(view(), 'first task');
  expect(selButton()).not.toBeNull();
});

test.each([
  ['a heading', 'A heading'],
  ['a code block', 'code line'],
  ['a table cell', 'cell one'],
])('no button for a selection inside %s', async (_n, needle) => {
  await openDoc(DOC);
  select(view(), needle);
  expect(selButton()).toBeNull();
});

test('no button for an empty selection or one spanning blocks', async () => {
  await openDoc(DOC);
  const n = select(view(), 'The estimate');
  act(() => {
    window.getSelection()!.setBaseAndExtent(n, 3, n, 3);
    document.dispatchEvent(new Event('selectionchange'));
  });
  expect(selButton()).toBeNull();
  const second = [...view().querySelectorAll('p')].find((p) => p.textContent === 'Second paragraph.')!;
  select(view(), 'holds', { node: second.firstChild!, offset: 6 });
  expect(selButton()).toBeNull();
});

test('no button for a selection containing a marker', async () => {
  await openDoc(`Before [💬](#md-thread-c20260910143022a3f9c1) after.\n\n<!--\n@thread c20260910143022a3f9c1\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nhi\n-->\n`);
  const marker = screen.getByRole('button', { name: '💬' });
  select(view(), 'Before', { node: marker.nextSibling!, offset: 3 });
  expect(selButton()).toBeNull();
  select(view(), 'after');
  expect(selButton()).not.toBeNull();
});

test('submitting a selection thread writes marker and block, opens the thread and clears the selection', async () => {
  const { user, saved } = await openDoc(DOC);
  select(view(), 'holds through Q3');
  await user.click(selButton()!);
  const box = screen.getByRole('textbox');
  await user.type(box, 'Where does this come from?');
  await user.click(screen.getByRole('button', { name: 'Submit' }));

  expect(window.getSelection()!.isCollapsed).toBe(true);
  expect(selButton()).toBeNull();
  const side = screen.getByRole('complementary', { name: 'Comments' });
  expect(within(side).getByRole('button', { name: 'Close thread' })).toBeInTheDocument();
  expect(within(side).getByText('Where does this come from?')).toBeInTheDocument();
  expect(within(view()).getByRole('button', { name: '💬' })).toBeInTheDocument();

  // Unsaved until saved.
  expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  const text = saved[saved.length - 1];
  expect(text).toMatch(new RegExp(`holds through Q3\\[💬\\]\\(#md-thread-${ID.source}\\) but not beyond\\.`));
  const [thread] = parseCommentThreads(text);
  expect(thread.anchor).toBe('holds through Q3');
  expect(thread.status).toBe('open');
  expect(thread.messages[0]).toMatchObject({ author: 'User', body: 'Where does this come from?' });
  expect(thread.messages[0].timestamp).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d[+-]\d\d:\d\d$/);
  expect(text.trimEnd().endsWith('-->')).toBe(true);
  expect(text.indexOf('<!--')).toBeGreaterThan(text.indexOf('Second paragraph.'));
});

test('blank or whitespace-only submit does nothing; cancel discards', async () => {
  const { user } = await openDoc(DOC);
  select(view(), 'holds');
  await user.click(selButton()!);
  await user.type(screen.getByRole('textbox'), '   \n ');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(screen.getByText('New comment')).toBeInTheDocument();
  expect(within(view()).queryByRole('button', { name: '💬' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByText('New comment')).toBeNull();
  expect(screen.getByRole('heading', { name: 'Comments' })).toBeInTheDocument();
  expect(within(view()).queryByRole('button', { name: '💬' })).toBeNull();
  expect(screen.queryByLabelText('unsaved changes')).toBeNull();
});

test('undo removes marker and block in one step', async () => {
  const { user, saved } = await openDoc('Hello brave world.\n');
  select(view(), 'brave');
  await user.click(selButton()!);
  await user.type(screen.getByRole('textbox'), 'note');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  expect(within(view()).getByRole('button', { name: '💬' })).toBeInTheDocument();
  await user.click(screen.getByRole('menuitem', { name: 'Edit' }));
  await user.click(await screen.findByRole('menuitem', { name: /Undo/ }));
  expect(within(view()).queryByRole('button', { name: '💬' })).toBeNull();
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  expect(saved[saved.length - 1]).toBe('Hello brave world.\n');
});

test('saved thread reopens as the same thread', async () => {
  const { user, files, saved } = await openDoc('Hello brave world.\n');
  select(view(), 'brave');
  await user.click(selButton()!);
  await user.type(screen.getByRole('textbox'), 'multi{enter}line');
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  expect(saved).toHaveLength(1);

  document.body.innerHTML = '';
  const user2 = userEvent.setup();
  render(<App files={files} />);
  await openFile(user2);
  await user2.click(screen.getByRole('button', { name: 'Comments' }));
  const row = within(screen.getByRole('list')).getByRole('button');
  expect(row).toHaveTextContent('brave');
  expect(row).toHaveTextContent('multi line');
  await user2.click(within(view()).getByRole('button', { name: '💬' }));
  expect(screen.getByText(/multi\s*line/).textContent).toBe('multi\nline');
});

test('a body containing --> and a bare --> line round-trips', async () => {
  const { user, saved } = await openDoc('Some text here.\n');
  select(view(), 'text');
  await user.click(selButton()!);
  const body = 'a --> b\n-->\nend';
  fireEvent.change(screen.getByRole('textbox'), { target: { value: body } });
  await user.click(screen.getByRole('button', { name: 'Submit' }));
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
  const [thread] = parseCommentThreads(saved[saved.length - 1]);
  expect(thread.messages[0].body).toBe(body);
});

describe('Add comment at the cursor', () => {
  async function addAtCaret(user: ReturnType<typeof userEvent.setup>, target: string) {
    await user.click(screen.getByText(target));
    await user.click(screen.getByRole('button', { name: 'Comments' }));
  }

  test('disabled with no cursor, and when the cursor is not in a paragraph or task item', async () => {
    const { user } = await openDoc(DOC);
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    expect(addButton()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    await addAtCaret(user, 'A heading');
    expect(addButton()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    await addAtCaret(user, 'code line here');
    expect(addButton()).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Comments' }));
    await addAtCaret(user, 'cell one');
    expect(addButton()).toBeDisabled();
  });

  test('opens a quote-less draft; submit puts the marker at the cursor and writes no @anchor', async () => {
    const { user, saved } = await openDoc(DOC);
    await addAtCaret(user, 'Second paragraph.');
    expect(addButton()).toBeEnabled();
    await user.click(addButton());
    expect(screen.getByText('New comment')).toBeInTheDocument();
    expect(screen.queryByText(/^On:/)).toBeNull();
    await user.type(screen.getByRole('textbox'), 'general remark');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
    const text = saved[saved.length - 1];
    expect(text).toMatch(new RegExp(`Second paragraph\\.\\[💬\\]\\(#md-thread-${ID.source}\\)`));
    expect(text).not.toContain('@anchor');
    expect(parseCommentThreads(text)[0].markers).toHaveLength(1);
  });

  test('works in a task item', async () => {
    const { user } = await openDoc(DOC);
    await addAtCaret(user, 'done task');
    expect(addButton()).toBeEnabled();
  });
});

describe('marker placement', () => {
  async function create(text: string, needle: string, endOffsetFromNeedleEnd = 0) {
    const { user, saved } = await openDoc(text);
    const n = select(view(), needle);
    if (endOffsetFromNeedleEnd !== 0) {
      const start = (n.textContent ?? '').indexOf(needle);
      select(view(), needle, { node: n, offset: start + needle.length + endOffsetFromNeedleEnd });
    }
    await user.click(selButton()!);
    await user.type(screen.getByRole('textbox'), 'c');
    await user.click(screen.getByRole('button', { name: 'Submit' }));
    await user.click(screen.getByRole('menuitem', { name: 'File' }));
    await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
    return saved[saved.length - 1];
  }

  test('a selection ending inside a link moves the marker past the link', async () => {
    const text = await create('See [the docs page](https://example.com/x) now.\n', 'the docs');
    expect(text).toMatch(/\[the docs page\]\(https:\/\/example\.com\/x\)\[💬\]\(#md-thread-/);
  });

  test('a selection ending inside a code span moves the marker past it', async () => {
    const text = await create('Run `npm run build` first.\n', 'npm run');
    expect(text).toMatch(/`npm run build`\[💬\]\(#md-thread-/);
  });

  test('never lands inside another marker', async () => {
    const id = 'c20260910143022a3f9c1';
    const doc = `Alpha [💬](#md-thread-${id}) beta gamma.\n\n<!--\n@thread ${id}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nhi\n-->\n`;
    const text = await create(doc, 'beta gamma');
    const threads = parseCommentThreads(text);
    expect(threads).toHaveLength(2);
    for (const t of threads) expect(t.markers).toHaveLength(1);
    expect(text).toContain(`Alpha [💬](#md-thread-${id}) beta gamma[💬]`);
  });

  test('trailing whitespace is ignored and the anchor is trimmed and collapsed', async () => {
    const text = await create('one two   three\nfour end.\n', 'two   three\nfour ');
    const [t] = parseCommentThreads(text);
    expect(t.anchor).toBe('two three four');
    expect(text).toMatch(/four\[💬\]\(#md-thread-[^)]+\) end\./);
  });

  test('two threads created in one second get different ids', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      const { user, saved } = await openDoc('Hello world today.\n');
      for (const word of ['Hello', 'today']) {
        select(view(), word);
        await user.click(selButton()!);
        await user.type(screen.getByRole('textbox'), 'x');
        await user.click(screen.getByRole('button', { name: 'Submit' }));
      }
      await user.click(screen.getByRole('menuitem', { name: 'File' }));
      await user.click(await screen.findByRole('menuitem', { name: /^Save(?! As)/ }));
      const ids = parseCommentThreads(saved[saved.length - 1]).map((t) => t.id);
      expect(new Set(ids).size).toBe(2);
      for (const id of ids) expect(id).toMatch(new RegExp(`^${ID.source}$`));
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('isCommentableAt', () => {
  const at = (text: string, marker = '^') => isCommentableAt(text.replace(marker, ''), text.indexOf(marker));
  test.each([
    ['paragraph', 'Some ^text.', true],
    ['task item', '- [ ] a ^task', true],
    ['quoted paragraph', '> quote ^here', true],
    ['heading', '## He^ad', false],
    ['setext heading', 'Ti^tle\n=====', false],
    ['fenced code', '```\nco^de\n```', false],
    ['indented code', '    co^de', false],
    ['table', '| a | b |\n| - | - |\n| ^c | d |', false],
    ['blank line', 'a\n\n^\nb', false],
    ['thematic break', '---^', false],
    ['html block', '<div>^x</div>', false],
  ])('%s', (_n, src, expected) => {
    expect(at(src)).toBe(expected);
  });
});
