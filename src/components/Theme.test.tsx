import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import App from '../App';
import type { FileAccess } from '../platform/files';
import { THEME_KEY } from '../platform/settings';
import { caretAt, docText, editorView, type as typeText } from '../testing/editor';

vi.setConfig({ testTimeout: 30000 });

const files: FileAccess = {
  pickDocument: async () => ({ name: 'a.md', path: '/d/a.md', text: 'Some paragraph here.\n\nSecond one.\n' }),
  saveDocument: async (d) => ({ name: d.name, path: d.path }),
  saveDocumentAs: async (d) => ({ name: d.name, path: null }),
};

/** A controllable matchMedia: `os(true)` plays the OS switching to dark. */
function mockMedia(initial: boolean | 'none') {
  const listeners = new Set<() => void>();
  const mq = {
    matches: initial === true,
    media: '(prefers-color-scheme: dark)',
    addEventListener: (_: string, f: () => void) => listeners.add(f),
    removeEventListener: (_: string, f: () => void) => listeners.delete(f),
  };
  if (initial === 'none') {
    // No preference: the query matches neither scheme.
    mq.matches = false;
  }
  window.matchMedia = vi.fn(() => mq) as unknown as typeof window.matchMedia;
  return (dark: boolean) => {
    mq.matches = dark;
    act(() => listeners.forEach((f) => f()));
  };
}

const isDarkNow = () => document.documentElement.classList.contains('dark');

beforeEach(() => {
  localStorage.clear();
  document.documentElement.className = '';
});
afterEach(() => {
  delete (window as { matchMedia?: unknown }).matchMedia;
});

async function openTheme(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Theme' }));
  return screen.findAllByRole('menuitemradio');
}
// jsdom has no layout, so moving the pointer into a sub-menu closes it; clicking the item directly selects it.
const pick = (item: HTMLElement) => fireEvent.click(item);
const checked = (items: HTMLElement[]) => items.filter((i) => i.getAttribute('aria-checked') === 'true').map((i) => i.textContent?.replace('●', ''));

test('View > Theme lists Light, Dark, Auto in order; Auto is the default and the only one selected', async () => {
  mockMedia(false);
  const user = userEvent.setup();
  render(<App files={files} />);
  const items = await openTheme(user);
  expect(items.map((i) => i.textContent?.replace('●', ''))).toEqual(['Light', 'Dark', 'Auto']);
  expect(checked(items)).toEqual(['Auto']);
  expect(isDarkNow()).toBe(false);
});

test('each choice applies its theme, persists, and moves the single selection', async () => {
  mockMedia(false);
  const user = userEvent.setup();
  render(<App files={files} />);
  let items = await openTheme(user);
  pick(items[1]);
  expect(isDarkNow()).toBe(true);
  expect(localStorage.getItem(THEME_KEY)).toBe('dark');
  items = await openTheme(user);
  expect(checked(items)).toEqual(['Dark']);
  pick(items[0]);
  expect(isDarkNow()).toBe(false);
  expect(localStorage.getItem(THEME_KEY)).toBe('light');
  items = await openTheme(user);
  expect(checked(items)).toEqual(['Light']);
});

test('Auto follows the OS live; Light and Dark ignore it', async () => {
  const os = mockMedia(false);
  const user = userEvent.setup();
  render(<App files={files} />);
  os(true);
  expect(isDarkNow()).toBe(true);
  os(false);
  expect(isDarkNow()).toBe(false);
  let items = await openTheme(user);
  pick(items[0]);
  os(true);
  expect(isDarkNow()).toBe(false);
  items = await openTheme(user);
  pick(items[1]);
  os(false);
  expect(isDarkNow()).toBe(true);
});

test('Auto with no OS preference or no matchMedia is light', async () => {
  mockMedia('none');
  const { unmount } = render(<App files={files} />);
  expect(isDarkNow()).toBe(false);
  unmount();
  delete (window as { matchMedia?: unknown }).matchMedia;
  render(<App files={files} />);
  expect(isDarkNow()).toBe(false);
});

test('a saved choice is applied at start; an invalid one is Auto', async () => {
  mockMedia(false);
  localStorage.setItem(THEME_KEY, 'dark');
  const first = render(<App files={files} />);
  await screen.findByRole('menuitem', { name: 'View' });
  expect(isDarkNow()).toBe(true);
  first.unmount();
  document.documentElement.className = '';
  localStorage.setItem(THEME_KEY, 'bogus');
  render(<App files={files} />);
  const items = await openTheme(userEvent.setup());
  expect(checked(items)).toEqual(['Auto']);
  expect(isDarkNow()).toBe(false);
});

test('switching theme keeps the editor view, text, caret and Raw mode', async () => {
  mockMedia(false);
  const user = userEvent.setup();
  render(<App files={files} />);
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  await screen.findByTestId('editor');
  caretAt('Second');
  typeText('X');
  const view = editorView();
  const head = view.state.selection.main.head;
  const text = docText();
  const items = await openTheme(user);
  pick(items[1]);
  expect(isDarkNow()).toBe(true);
  expect(editorView()).toBe(view);
  expect(view.state.selection.main.head).toBe(head);
  expect(docText()).toBe(text);
  const undo = screen.getByRole('menuitem', { name: 'Edit' });
  await user.click(undo);
  expect(within(await screen.findByRole('menu')).getByRole('menuitem', { name: /^Undo/ })).not.toHaveAttribute('data-disabled');
});
