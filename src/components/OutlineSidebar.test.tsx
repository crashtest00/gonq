import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';
import type { FileAccess, OpenedDocument } from '../platform/files';

const doc: OpenedDocument = { name: 'n.md', path: '/n.md', text: '# Title\n\nintro\n\n## Part A\n\nbody\n\n## Part B\n' };
const files: FileAccess = {
  pickDocument: async () => doc,
  loadImage: async () => null,
  saveDocument: async (d) => ({ name: d.name, path: d.path }),
  saveDocumentAs: async (d) => ({ name: d.name, path: null }),
};

async function open() {
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
  await screen.findByRole('heading', { level: 1, name: 'Title' });
  return user;
}

test('the toggle shows and hides the outline', async () => {
  const user = await open();
  const toggle = screen.getByRole('button', { name: 'Document outline' });
  expect(screen.queryByRole('complementary', { name: 'Outline' })).not.toBeInTheDocument();
  await user.click(toggle);
  const pane = screen.getByRole('complementary', { name: 'Outline' });
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
  const h = screen.getByRole('heading', { name: 'Part B' });
  h.getBoundingClientRect = () => ({ top: 500 }) as DOMRect;
  await user.click(screen.getByRole('button', { name: 'Part B' }));
  expect(main.scrollTop).toBe(480);
});

test('an empty outline says so', async () => {
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.click(screen.getByRole('button', { name: 'Document outline' }));
  expect(screen.getByText('No headings.')).toBeInTheDocument();
});
