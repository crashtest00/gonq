/** The whole menu tree (labels, shortcuts, enabled/checked state, separators, sub-menus) in six app states, as a snapshot that is the same on desktop and web. */
import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { isolateHistory } from '@codemirror/commands';
import { vi } from 'vitest';
import { renderApp, testDoc, type User } from '../testing/renderApp';
import { editorView, settleEditors } from '@gonq/editor/testing/editor';

vi.setConfig({ testTimeout: 60000 });

// `desktop` flips what the platform reports; the desktop commands the app calls at start-up are answered here.
const platform = vi.hoisted(() => ({ desktop: false, theme: 'auto' }));
vi.mock('@gonq/editor/platform/files', async (importActual) => ({
  ...(await importActual<typeof import('@gonq/editor/platform/files')>()),
  isTauri: () => platform.desktop,
}));
const invoke = async (cmd: string, args?: { theme?: string }) => {
  if (cmd === 'get_theme') return platform.theme;
  if (cmd === 'set_theme') return (platform.theme = args?.theme ?? 'auto');
  if (cmd === 'get_author_name') return 'Author';
  if (cmd === 'take_launch_paths' || cmd.startsWith('recent_documents')) return [];
  return undefined;
};
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: [string, { theme?: string }?]) => invoke(...a) }));
vi.mock('@gonq/editor/platform/bindings', async () => (await import('@gonq/editor/testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));
vi.mock('@tauri-apps/api/event', () => ({ listen: async () => () => {} }));
vi.mock('@gonq/editor/platform/lifecycle', () => ({ guardClose: () => () => {} }));

const DOC = '# Title\n\nSome text.\n\n| a | b |\n| - | - |\n| 1 | 2 |\n';

interface Item {
  kind: 'item' | 'checkbox' | 'radio' | 'separator' | 'submenu';
  label?: string;
  shortcut?: string;
  disabled?: boolean;
  checked?: boolean;
  items?: Item[];
}

const flag = (el: Element) => el.hasAttribute('data-disabled') || el.getAttribute('aria-disabled') === 'true' || (el as HTMLButtonElement).disabled === true;
const menus = () => screen.queryAllByRole('menu');

/** Reads one open menu: its entries in order; sub-menus are opened and read in place. */
async function readMenu(user: User, root: HTMLElement): Promise<Item[]> {
  const entries = [...root.querySelectorAll<HTMLElement>('[role^="menuitem"], [role="separator"]')].filter((e) => e.closest('[role="menu"]') === root);
  const out: Item[] = [];
  for (const e of entries) {
    if (e.getAttribute('role') === 'separator') {
      out.push({ kind: 'separator' });
      continue;
    }
    const shortcut = e.querySelector('.ml-auto')?.textContent ?? undefined;
    const label = (e.textContent ?? '').replace(shortcut ?? '', '').replace('●', '').trim();
    const role = e.getAttribute('role');
    const base = { label, ...(shortcut ? { shortcut } : {}), disabled: flag(e) };
    if (e.getAttribute('aria-haspopup') === 'menu') {
      const before = menus().length;
      await user.click(e);
      await waitFor(() => expect(menus().length).toBe(before + 1));
      const sub = menus()[menus().length - 1];
      out.push({ kind: 'submenu', ...base, items: await readMenu(user, sub) });
    } else if (role === 'menuitemcheckbox') out.push({ kind: 'checkbox', ...base, checked: e.getAttribute('aria-checked') === 'true' });
    else if (role === 'menuitemradio') out.push({ kind: 'radio', ...base, checked: e.getAttribute('aria-checked') === 'true' });
    else out.push({ kind: 'item', ...base });
  }
  return out;
}

/** Every top-level menu with its enabled state, opened one by one. */
async function readTree(user: User) {
  const triggers = screen.getAllByRole('menuitem').filter((t) => t.closest('[role="menubar"]') !== null);
  const tree: { menu: string; disabled: boolean; items: Item[] | null }[] = [];
  // Opening a menu takes the focus out of a targeted table cell, which the Table sub-menu depends on: Format goes first.
  const order = [...triggers].sort((a, b) => Number(b.textContent === 'Format') - Number(a.textContent === 'Format'));
  for (const t of order) {
    const entry = { menu: t.textContent ?? '', disabled: flag(t), items: null as Item[] | null };
    if (!entry.disabled) {
      await user.click(t);
      await waitFor(() => expect(menus()).toHaveLength(1));
      entry.items = await readMenu(user, menus()[0]);
      // A sub-menu is left open (each menu's is its last entry); Escape closes it first, then the menu.
      for (let i = 0; i < 2 && menus().length > 0; i++) await user.keyboard('{Escape}');
      await waitFor(() => expect(menus()).toHaveLength(0));
    }
    tree.push(entry);
  }
  return triggers.map((t) => tree.find((e) => e.menu === t.textContent)!);
}

const open = async (user: User) => {
  await user.click(screen.getByRole('menuitem', { name: 'File' }));
  await user.click(await screen.findByRole('menuitem', { name: /^Open…/ }));
  const editor = await screen.findByTestId('editor');
  settleEditors(editor);
};

const STATES: Record<string, (user: User) => Promise<void>> = {
  'no document': async () => {},
  'document open, formatted, theme auto': open,
  'table cell targeted': async (user) => {
    await open(user);
    const cell = await waitFor(() => {
      const td = screen.getByTestId('editor').querySelector<HTMLElement>('td');
      if (!td) throw new Error('no table yet');
      return td;
    });
    cell.focus();
    await screen.findByRole('toolbar', { name: 'Table' });
  },
  'raw mode on': async (user) => {
    await open(user);
    await user.click(screen.getByRole('switch', { name: /Raw Markdown/ }));
    await waitFor(() => expect(screen.getByRole('switch', { name: /Raw Markdown/ })).toBeChecked());
  },
  'undo and redo available': async (user) => {
    await open(user);
    const view = editorView();
    act(() => view.dispatch({ changes: { from: 0, insert: 'a' }, annotations: isolateHistory.of('full') }));
    act(() => view.dispatch({ changes: { from: 0, insert: 'b' }, annotations: isolateHistory.of('full') }));
    await user.click(screen.getByRole('button', { name: /Undo/ }));
    await waitFor(() => expect(screen.getByRole('button', { name: /Redo/ })).toBeEnabled());
    expect(screen.getByRole('button', { name: /Undo/ })).toBeEnabled();
  },
  'theme dark': async (user) => {
    await open(user);
    await user.click(screen.getByRole('menuitem', { name: 'View' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Theme' }));
    // jsdom has no layout, so a click on the item itself picks it.
    fireEvent.click(await screen.findByRole('menuitemradio', { name: /Dark/ }));
    await waitFor(() => expect(document.documentElement.classList.contains('dark')).toBe(true));
    await waitFor(() => expect(menus()).toHaveLength(0));
  },
};

async function capture(state: string, desktop: boolean) {
  platform.desktop = desktop;
  platform.theme = 'auto';
  localStorage.clear();
  document.documentElement.className = '';
  const { user, unmount } = renderApp({ docs: testDoc(DOC) });
  try {
    await STATES[state](user);
    return JSON.stringify(await readTree(user), null, 2);
  } finally {
    unmount();
  }
}

describe('menu tree', () => {
  test.each(Object.keys(STATES))('%s', async (state) => {
    const desktop = await capture(state, true);
    const web = await capture(state, false);
    // Nothing is hidden or disabled by platform.
    expect(web).toBe(desktop);
    expect(desktop).toMatchSnapshot();
  });
});
