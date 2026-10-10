import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, vi } from 'vitest';
import { activeBlocks, selectSource } from '../testing/inplace';
import App from '../App';
import type { FileAccess, OpenedDocument } from '../platform/files';

// Each test drives the whole app through user-event; on slow CI they run close to the 5s default.
vi.setConfig({ testTimeout: 30000 });

afterEach(() => cleanup());

const doc: OpenedDocument = { name: 'n.md', path: '/n.md', text: '# Title\n\nintro\n\n## Part A\n\nbody\n\n## Part B\n' };
const files: FileAccess = {
  pickDocument: async () => doc,
  loadImage: async () => null,
  saveDocument: async (d) => ({ name: d.name, path: d.path }),
  saveDocumentAs: async (d) => ({ name: d.name, path: null }),
};

async function open(d: OpenedDocument = doc) {
  const user = userEvent.setup();
  render(<App files={{ ...files, pickDocument: async () => d }} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
  await screen.findByTestId('markdown-view');
  return user;
}

test('the toggle shows and hides the outline', async () => {
  const user = await open();
  const toggle = screen.getByRole('button', { name: 'Document outline' });
  expect(screen.queryByRole('complementary', { name: 'Outline' })).not.toBeInTheDocument();
  await user.click(toggle);
  const pane = await screen.findByRole('complementary', { name: 'Outline' });
  expect(toggle).toHaveAttribute('aria-pressed', 'true');
  expect(Array.from(pane.querySelectorAll('li')).map((li) => li.textContent)).toEqual(['Title', 'Part A', 'Part B']);
  await user.click(toggle);
  expect(screen.queryByRole('complementary', { name: 'Outline' })).not.toBeInTheDocument();
});

test('clicking an entry scrolls to its heading', async () => {
  const user = await open();
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  const main = screen.getByRole('main');
  main.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  const h = await screen.findByRole('heading', { name: 'Part B' });
  h.getBoundingClientRect = () => ({ top: 500 }) as DOMRect;
  await user.click(screen.getByRole('button', { name: 'Part B' }));
  expect(main.scrollTop).toBe(480);
});

test('an empty outline says so', async () => {
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  expect(await screen.findByText('No headings.')).toBeInTheDocument();
});

const entries = async () => (await screen.findByRole('complementary', { name: 'Outline' })).querySelectorAll('li');
const texts = async (expected: string[]) =>
  waitFor(async () => expect(Array.from(await entries()).map((li) => li.textContent)).toEqual(expected));

test('H3 is excluded, setext H1 and H2 are included', async () => {
  const user = await open({ ...doc, text: 'Setext One\n===\n\nSetext Two\n---\n\n### Deep\n\n## Atx\n' });
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  await texts(['Setext One', 'Setext Two', 'Atx']);
});

test('a heading with a marker shows its text without the glyph', async () => {
  const user = await open({ ...doc, text: '# Marked [💬](#md-thread-abc) heading\n' });
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  await texts(['Marked heading']);
});

test('identical headings each scroll to their own position', async () => {
  const user = await open({ ...doc, text: '## Same\n\none\n\n## Same\n\ntwo\n' });
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  const main = screen.getByRole('main');
  main.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  const [first, second] = screen.getAllByRole('heading', { name: 'Same' });
  first.getBoundingClientRect = () => ({ top: 120 }) as DOMRect;
  second.getBoundingClientRect = () => ({ top: 700 }) as DOMRect;
  const [b1, b2] = screen.getAllByRole('button', { name: 'Same' });
  await user.click(b2);
  expect(main.scrollTop).toBe(680);
  main.scrollTop = 0;
  await user.click(b1);
  expect(main.scrollTop).toBe(100);
});

test('renaming, adding and removing a heading updates the outline live', async () => {
  const user = await open();
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  const edit = async (target: string, value: string) => {
    await user.click(await screen.findByText(target, { selector: 'main *' }));
    await waitFor(() => expect(activeBlocks()).toHaveLength(1));
    const block = activeBlocks()[0];
    // Replace the whole block, as the text field used to be cleared and retyped.
    await selectSource(Number(block.dataset.from), Number(block.dataset.to));
    await user.paste(value);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(activeBlocks()).toHaveLength(0));
  };
  await edit('Part A', '## Renamed');
  await texts(['Title', 'Renamed', 'Part B']);
  await edit('intro', 'intro\n\n## Added');
  await texts(['Title', 'Added', 'Renamed', 'Part B']);
  await edit('Renamed', 'plain text');
  await texts(['Title', 'Added', 'Part B']);
});

test('a document with text but no headings says "No headings."', async () => {
  const user = await open({ ...doc, text: 'just a paragraph\n\nanother\n' });
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  expect(await screen.findByText('No headings.')).toBeInTheDocument();
});

test('a document with only H2s uses H2 styling', async () => {
  const user = await open({ ...doc, text: '## Only A\n\n## Only B\n' });
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  const btn = screen.getByRole('button', { name: 'Only A' });
  expect(btn).toHaveClass('text-[12.5px]', 'text-muted-foreground');
  expect(btn).not.toHaveClass('font-semibold');
  expect(btn.style.paddingLeft).toBe('22px');
});
