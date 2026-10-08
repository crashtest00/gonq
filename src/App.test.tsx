import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { NotUtf8Error, type FileAccess, type OpenedDocument } from './platform/files';

function fakeFiles(pick: () => Promise<OpenedDocument | null>, image: string | null = null): FileAccess {
  return { pickDocument: pick, loadImage: async () => image };
}

async function openMenuItem() {
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /Open/ }));
}

test('shows the menu bar and no editing or left-sidebar controls', () => {
  render(<App files={fakeFiles(async () => null)} />);
  for (const name of ['File', 'Edit', 'View', 'Insert', 'Format', 'Help']) {
    expect(screen.getByRole('menuitem', { name })).toBeInTheDocument();
  }
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
  expect(screen.queryByRole('switch')).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/outline|folder/i)).not.toBeInTheDocument();
});

test('File > Open renders the file and names the tab', async () => {
  const doc: OpenedDocument = { name: 'notes.md', path: '/tmp/notes.md', text: '# Title\n\nHello **world**.\n' };
  render(<App files={fakeFiles(async () => doc)} />);
  await openMenuItem();
  expect(await screen.findByRole('heading', { level: 1, name: 'Title' })).toBeInTheDocument();
  expect(screen.getByRole('tab')).toHaveTextContent('notes.md');
});

test('cancelling the dialog changes nothing', async () => {
  render(<App files={fakeFiles(async () => null)} />);
  await openMenuItem();
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a file that is not valid UTF-8 shows an error and is not opened', async () => {
  render(
    <App
      files={fakeFiles(async () => {
        throw new NotUtf8Error('bad.md');
      })}
    />,
  );
  await openMenuItem();
  expect(await screen.findByRole('alert')).toHaveTextContent('bad.md is not valid UTF-8');
  expect(screen.queryByRole('tab')).not.toBeInTheDocument();
});

test('an empty document renders without error', async () => {
  const doc: OpenedDocument = { name: 'empty.md', path: null, text: '' };
  render(<App files={fakeFiles(async () => doc)} />);
  await openMenuItem();
  await waitFor(() => expect(screen.getByRole('tab')).toHaveTextContent('empty.md'));
  expect(screen.getByTestId('markdown-view')).toBeEmptyDOMElement();
  expect(within(document.body).queryByRole('alert')).not.toBeInTheDocument();
});
