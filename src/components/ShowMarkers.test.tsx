import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from './../App';
import type { FileAccess } from '../platform/files';
import { SHOW_MARKERS_KEY } from '../platform/settings';

vi.setConfig({ testTimeout: 30000 });

const A = 'c20260910143022a3f9c1';
const MARKER = `[💬](#md-thread-${A})`;
const DOC = `Para one ${MARKER} here.\n\n<!--\n@thread ${A}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nFirst?\n-->\n`;

beforeEach(() => localStorage.clear());

async function openDoc() {
  const saved: string[] = [];
  const files: FileAccess = {
    pickDocument: async () => ({ name: 'a.md', path: '/d/a.md', text: DOC }),
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

const editor = () => screen.getByLabelText('Markdown source of this block') as HTMLTextAreaElement;

test('markers show as source in the edited block by default', async () => {
  const { user } = await openDoc();
  await user.click(screen.getByText(/Para one/));
  expect(editor().value).toBe(`Para one ${MARKER} here.`);
});

test('turning the option off hides marker source, keeps the marker on edit, and persists', async () => {
  const { user } = await openDoc();
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  const item = await screen.findByRole('menuitemcheckbox', { name: /Show markers in active block/ });
  expect(item).toBeChecked();
  await user.click(item);
  expect(localStorage.getItem(SHOW_MARKERS_KEY)).toBe('false');

  await user.click(screen.getByText(/Para one/));
  expect(editor().value).toBe('Para one 💬 here.');
  await user.type(editor(), '!');
  expect(editor().value).toBe('Para one 💬 here.!');
  expect(screen.getByLabelText('Markdown source of this block')).toBeTruthy();
  await user.keyboard('{Escape}');
  await user.click(screen.getByText(/Para one/));
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  expect(await screen.findByRole('menuitemcheckbox', { name: /Show markers in active block/ })).not.toBeChecked();
});

test('a saved "off" is restored on start', async () => {
  localStorage.setItem(SHOW_MARKERS_KEY, 'false');
  const { user } = await openDoc();
  await user.click(screen.getByText(/Para one/));
  expect(editor().value).toBe('Para one 💬 here.');
});
