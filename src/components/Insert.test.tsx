import { undo } from '@codemirror/commands';
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { act } from 'react';
import { vi } from 'vitest';
import { caretAt, docText, editorView, select, shownText, type } from '../testing/editor';
import App from './../App';
import type { FileAccess } from '../platform/files';

vi.setConfig({ testTimeout: 30000 });

const mocks = vi.hoisted(() => ({ pickImage: vi.fn(), loadImage: vi.fn() }));
vi.mock('../platform/images', () => ({ pickImage: mocks.pickImage, loadImage: mocks.loadImage }));

const DOC = '# One\n\ntext\n\n## Two\n\n### Three\n\n## Four\n';

async function openDoc(text = DOC) {
  const user = userEvent.setup();
  const files: FileAccess = {
    pickDocument: async () => ({ name: 'a.md', path: '/d/a.md', text }),
    saveDocument: async (d) => ({ name: d.name, path: d.path }),
    saveDocumentAs: async (d) => ({ name: d.name, path: null }),
  };
  render(<App files={files} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  await screen.findByTestId('editor');
  return user;
}

const insert = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole('menuitem', { name: 'Insert' }));
  await user.click(await screen.findByRole('menuitem', { name }));
};
const undoAll = () => act(() => void undo(editorView()));

const LIST = ['- [One](#one)', '  - [Two](#two)', '    - [Three](#three)', '  - [Four](#four)'].join('\n');

beforeEach(() => {
  mocks.pickImage.mockReset();
  mocks.loadImage.mockReset().mockResolvedValue('data:image/png;base64,AAAA');
});

test('the Insert menu offers Image and Table of Contents', async () => {
  const user = await openDoc();
  await user.click(screen.getByRole('menuitem', { name: 'Insert' }));
  expect(await screen.findByRole('menuitem', { name: 'Image…' })).toBeEnabled();
  expect(screen.getByRole('menuitem', { name: 'Table of Contents' })).toBeEnabled();
});

test('Image inserts a reference at the caret as one undo step, and it renders', async () => {
  mocks.pickImage.mockResolvedValue({ src: 'img/pic.png', alt: 'pic' });
  const user = await openDoc();
  caretAt('text');
  await insert(user, 'Image…');
  await vi.waitFor(() => expect(docText()).toContain('text![pic](img/pic.png)'));
  expect(mocks.pickImage).toHaveBeenCalledWith('/d/a.md');
  await vi.waitFor(() => expect(document.querySelector('.cm-image img')).not.toBeNull());
  undoAll();
  expect(docText()).toBe(DOC);
});

test('cancelling the picker changes nothing; a picker error reaches the banner', async () => {
  mocks.pickImage.mockResolvedValueOnce(null);
  const user = await openDoc();
  await insert(user, 'Image…');
  expect(docText()).toBe(DOC);
  mocks.pickImage.mockRejectedValueOnce(new Error('pic.png is 40 MB; too large'));
  await insert(user, 'Image…');
  expect(await screen.findByText(/40 MB/)).toBeInTheDocument();
  expect(docText()).toBe(DOC);
});

test('a missing image shows the fallback', async () => {
  mocks.loadImage.mockRejectedValue(new Error('gone.png could not be read'));
  mocks.pickImage.mockResolvedValue({ src: 'gone.png', alt: 'gone' });
  const user = await openDoc();
  select(docText().length);
  await insert(user, 'Image…');
  await vi.waitFor(() => expect(document.querySelector('.cm-image-missing')).not.toBeNull());
});

test('Table of Contents inserts a nested list of the headings; Refresh is its only update', async () => {
  const user = await openDoc();
  caretAt('text');
  await insert(user, 'Table of Contents');
  expect(docText()).toContain(`<!-- toc -->\n${LIST}\n<!-- /toc -->`);
  expect(docText()).not.toContain('toc -->\n\n\n');
  // Formatted mode shows a label and a Refresh button, not the markers.
  expect(shownText()).toContain('Contents');
  expect(shownText()).not.toContain('<!--');

  // Editing a heading leaves the list as it was.
  caretAt('## Four');
  type(' more');
  expect(docText()).toContain('## Four more');
  expect(docText()).toContain('- [Four](#four)\n<!-- /toc -->');

  // Refresh rebuilds it, as one undo step.
  const before = docText();
  fireEvent.click(screen.getByRole('button', { name: 'Refresh table of contents' }));
  expect(docText()).toContain('- [Four more](#four-more)');
  expect(docText()).not.toContain('- [Four](#four)');
  undoAll();
  expect(docText()).toBe(before);
});

test('a document without headings gets an empty-state list', async () => {
  const user = await openDoc('only text\n');
  await insert(user, 'Table of Contents');
  expect(docText()).toContain('<!-- toc -->\n_No headings yet._\n<!-- /toc -->');
});

test('inserting a second table of contents refreshes the one there instead of adding another', async () => {
  const user = await openDoc();
  await insert(user, 'Table of Contents');
  caretAt('### Three');
  type(' X');
  await insert(user, 'Table of Contents');
  expect(docText().match(/<!-- toc -->/g)).toHaveLength(1);
  expect(docText()).toContain('- [Three X](#three-x)');
});

test('Raw mode shows the markers as text', async () => {
  const user = await openDoc();
  await insert(user, 'Table of Contents');
  await user.click(screen.getByRole('switch'));
  expect(shownText()).toContain('<!-- toc -->');
  expect(document.querySelector('.cm-toc-refresh')).toBeNull();
});
