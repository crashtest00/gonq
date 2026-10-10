import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './App';
import type { FileAccess, OpenedDocument } from './platform/files';
import { caretIn, shownMarkers, view } from './testing/inplace';

vi.setConfig({ testTimeout: 30000 });
vi.mock('./platform/lifecycle', () => ({ guardClose: () => () => {} }));

beforeEach(() => localStorage.clear());

type User = ReturnType<typeof userEvent.setup>;

function setup(text: string) {
  const doc: OpenedDocument = { name: 'a.md', path: '/d/a.md', text };
  const saveDocument = vi.fn(async (d: { name: string; path: string | null; text: string }) => ({ name: d.name, path: d.path ?? '/d/new.md' }));
  const files: FileAccess = { pickDocument: async () => doc, loadImage: async () => null, saveDocument, saveDocumentAs: vi.fn() };
  const user = userEvent.setup();
  render(<App files={files} />);
  return { user, saveDocument };
}

async function openDoc(user: User) {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
  await screen.findByTestId('markdown-view');
}

const markersOff = async (user: User) => {
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  await user.click(await screen.findByRole('menuitemcheckbox', { name: /Show markers in active block/ }));
};

const save = async (user: User, saveDocument: { mock: { calls: any[][] } }) => {
  await user.keyboard('{Escape}{Control>}s{/Control}');
  return saveDocument.mock.calls[saveDocument.mock.calls.length - 1]?.[0].text as string;
};

const cells = () => Array.from(view().querySelectorAll<HTMLElement>('td, th'));
/** A cell by its visible text (syntax spans are not text the user sees). */
const cell = (text: string) => cells().find((c) => (c.textContent ?? '').replace(/[|\s]/g, '') === text.replace(/[|\s]/g, ''))!;
const press = (user: User, name: string) => user.click(screen.getByRole('button', { name }));

const TABLE = '| a | b |\n| - | - |\n| 1 | 2 |\n\nafter\n';

describe('undo and redo of a cell edit', () => {
  test('one step; the document is clean again after undo', async () => {
    const { user, saveDocument } = setup(TABLE);
    await openDoc(user);
    await user.click(cell('1'));
    await caretIn(cell('1'));
    await user.keyboard('234');
    expect(screen.getByLabelText('unsaved changes')).toBeInTheDocument();
    await press(user, 'Undo');
    expect(cell('1')).toBeInTheDocument();
    expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Undo' })).toBeDisabled();
    await press(user, 'Redo');
    expect(cell('1234')).toBeInTheDocument();
    expect(await save(user, saveDocument)).toBe('| a | b |\n| - | - |\n| 1234 | 2 |\n\nafter\n');
  });
});

describe('Show markers on and off', () => {
  test.each([['on', false], ['off', true]])('with the option %s no pipe or delimiter is shown while a cell is edited', async (_n, off) => {
    const { user } = setup(TABLE);
    await openDoc(user);
    if (off) await markersOff(user);
    await user.click(cell('1'));
    await caretIn(cell('1'));
    await user.keyboard('x');
    expect(view().dataset.markers).toBe(off ? 'off' : 'on');
    expect(shownMarkers()).toEqual([]);
    // Everything of the syntax inside the table is hidden by the stylesheet, as shownMarkers() ignores tables: check the classes.
    const table = screen.getByRole('table');
    const visible = Array.from(table.querySelectorAll('[data-s]')).filter((s) => !s.closest('td, th') || s.classList.contains('gonq-mk'));
    for (const s of visible) expect(s.classList.contains('gonq-mk') || s.closest('tr')?.hasAttribute('hidden')).toBeTruthy();
  });
});

test('the stylesheet hides table syntax whether the table or a list/quote around it is the active block', async () => {
  const css = ((await import('node:fs' as string)) as { readFileSync: (p: string, e: string) => string }).readFileSync('src/styles/document.css', 'utf8');
  expect(css).toContain(".gonq-doc[data-markers='on'] table[data-active] .gonq-mk,");
  expect(css).toContain(".gonq-doc[data-markers='on'] [data-active] table .gonq-mk { display: none; }");
});

describe('inline Markdown in cells', () => {
  const T = '| h | i |\n| - | - |\n| **bold** | [l](http://x) `c` |\n';
  test('keeps its formatting when not edited, and typing next to it keeps it', async () => {
    const { user, saveDocument } = setup(T);
    await openDoc(user);
    expect(view().querySelector('td strong')?.textContent).toBe('bold');
    expect(view().querySelector('td a')?.textContent).toBe('l');
    expect(view().querySelector('td code')?.textContent).toBe('c');
    await user.click(view().querySelector('td strong')!);
    await caretIn(view().querySelector('td strong')!.closest('td')!, 'end');
    await user.keyboard('!');
    expect(view().querySelector('td strong')).not.toBeNull();
    expect(await save(user, saveDocument)).toBe('| h | i |\n| - | - |\n| **bold!** | [l](http://x) `c` |\n');
    expect(view().querySelector('td strong')?.textContent).toBe('bold!');
  });
});

describe('byte-identical saves', () => {
  const ALIGN = '| a | b | c |\n|:---|:---:|---:|\n| 1 | 2 | 3 |\n';
  test.each([['LF', '\n'], ['CRLF', '\r\n']])('visiting cells without editing saves identical text (%s)', async (_n, eol) => {
    const text = ALIGN.replace(/\n/g, eol);
    const { user, saveDocument } = setup(text);
    await openDoc(user);
    for (const c of ['1', '2', '3']) {
      await user.click(cell(c));
      await caretIn(cell(c), 0);
    }
    await user.keyboard('{Tab}{Tab}');
    await user.keyboard('{Escape}');
    expect(screen.queryByLabelText('unsaved changes')).not.toBeInTheDocument();
    await user.keyboard('{Control>}s{/Control}');
    const saved = saveDocument.mock.calls[saveDocument.mock.calls.length - 1]?.[0].text ?? text;
    expect(saved).toBe(text);
  });

  test.each([['LF', '\n'], ['CRLF', '\r\n']])('editing one cell keeps alignment markers byte for byte (%s)', async (_n, eol) => {
    const text = ALIGN.replace(/\n/g, eol);
    const { user, saveDocument } = setup(text);
    await openDoc(user);
    await user.click(cell('2'));
    await caretIn(cell('2'));
    await user.keyboard('x');
    expect(await save(user, saveDocument)).toBe(text.replace('| 2 |', '| 2x |'));
  });
});

describe('toolbar table insert', () => {
  test('still inserts a table, which can then be edited in place', async () => {
    const { user, saveDocument } = setup('text\n');
    await openDoc(user);
    await user.click(screen.getByText('text'));
    await caretIn(screen.getByText('text'));
    await press(user, 'Insert table');
    expect(screen.getByRole('table')).toBeInTheDocument();
    const target = cells().find((c) => /Cell/.test(c.textContent ?? ''))!;
    await caretIn(target);
    await user.keyboard('X');
    const saved = await save(user, saveDocument);
    expect(saved).toContain('| Column 1 | Column 2 |\n| --- | --- |\n| CellX | Cell |');
  });
});

describe('edge cases', () => {
  test('an escaped pipe already in a cell: edit around it', async () => {
    const { user, saveDocument } = setup('| a | b |\n| - | - |\n| x\\|y | 2 |\n');
    await openDoc(user);
    await user.click(cell('x|y'));
    await caretIn(cell('x|y'), 'end');
    await user.keyboard('z');
    expect(await save(user, saveDocument)).toBe('| a | b |\n| - | - |\n| x\\|yz | 2 |\n');
  });

  test('escaped pipe: typing before and after it', async () => {
    const { user, saveDocument } = setup('| a | b |\n| - | - |\n| x\\|y | 2 |\n');
    await openDoc(user);
    await user.click(cell('x|y'));
    await caretIn(cell('x|y'), 2);
    await user.keyboard('Q');
    expect(await save(user, saveDocument)).toBe('| a | b |\n| - | - |\n| x\\|Qy | 2 |\n');
  });

  test('rows with fewer or more cells than the header', async () => {
    const T = '| a | b |\n| - | - |\n| 1 |\n| 2 | 3 | 4 |\n';
    const { user, saveDocument } = setup(T);
    await openDoc(user);
    await user.click(cell('1'));
    await caretIn(cell('1'));
    await user.keyboard('x');
    expect(await save(user, saveDocument)).toBe('| a | b |\n| - | - |\n| 1x |\n| 2 | 3 | 4 |\n');
  });

  test.each([
    ['a list item', '- item\n\n  | a | b |\n  | - | - |\n  | 1 | 2 |\n', '  | 1x | 2 |'],
    ['a quote', '> | a | b |\n> | - | - |\n> | 1 | 2 |\n', '> | 1x | 2 |'],
  ])('a table inside %s is edited in place', async (_n, text, expected) => {
    const { user, saveDocument } = setup(text);
    await openDoc(user);
    await user.click(cell('1'));
    await caretIn(cell('1'));
    await user.keyboard('x');
    expect(screen.getByRole('table')).toBeInTheDocument();
    expect(await save(user, saveDocument)).toBe(text.replace(/.*\| 1 \| 2 \|/, expected));
  });

  test('a very wide table sits in a horizontal scroller and does not reflow', async () => {
    const n = 40;
    const row = (f: (i: number) => string) => '| ' + Array.from({ length: n }, (_, i) => f(i)).join(' | ') + ' |';
    const { user } = setup([row((i) => `h${i}`), row(() => '---'), row((i) => `c${i}`)].join('\n') + '\n');
    await openDoc(user);
    await user.click(cell('c0'));
    const table = screen.getByRole('table');
    // jsdom does not load the stylesheet: the table itself must be the horizontal scroller, with no wrapping of cells.
    const css = ((await import('node:fs' as string)) as { readFileSync: (p: string, e: string) => string }).readFileSync('src/styles/document.css', 'utf8');
    expect(css).toMatch(/\.gonq-doc table \{[^}]*display: block;[^}]*max-width: 100%;[^}]*overflow-x: auto;/);
    expect(cells()).toHaveLength(2 * n);
    expect(table.querySelectorAll('tr')).toHaveLength(2);
  });
});
