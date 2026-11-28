/** Covers the mobile ☰ menu drawer through renderMobileApp: the leading ☰ on the home and the editor (no Back, no ⋯), the drill-down (menus, items, submenus), registry order, disabled/check/radio rows, EXCLUDED_COMMAND_IDS, the three ways to close, Back one level at a time, running a command, and the 44px tap class. */
import { act, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
let backHandler: (() => void) | null = null;
vi.mock('@gonq/editor/platform/backButton', () => ({
  onAndroidBack: (h: () => void) => {
    backHandler = h;
    return () => {};
  },
  leaveApp: vi.fn(() => Promise.resolve()),
}));

import { registry } from '@gonq/editor/commands';
import { EXCLUDED_COMMAND_IDS } from '../excludedCommands';
import { openMenu } from '../testing/menu';
import { renderMobileApp } from '../testing/renderMobileApp';

/** The registry's menu labels in order, read from a throwing-safe context (resolveMenus logs and treats a failing enabled() as false). */
const quiet = vi.spyOn(console, 'error').mockImplementation(() => {});
const MENU_ORDER = registry.resolveMenus({} as never).map((m) => m.menu.label);
quiet.mockRestore();
const back = () => act(async () => backHandler?.());
const drawer = () => screen.getByRole('dialog', { name: 'Menu' });

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve([]);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    return Promise.resolve(undefined);
  });
});

async function newDoc(r?: Awaited<ReturnType<typeof renderMobileApp>>) {
  r ??= await renderMobileApp();
  await r.user.click(screen.getByRole('button', { name: 'New' }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  return r;
}

it('puts ☰ first in the home top bar and in the editor in place of Back; ⋯ is gone', async () => {
  const r = await renderMobileApp();
  const { container } = r;
  expect(container.querySelector('.m-topbar')!.firstElementChild).toBe(screen.getByRole('button', { name: 'Menu' }));
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
  await newDoc(r);
  expect(document.querySelector('.m-topbar')!.firstElementChild).toBe(screen.getByRole('button', { name: 'Menu' }));
  expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  expect(screen.queryByRole('button', { name: 'More' })).toBeNull();
});

it('lists the registry menus in registry order, each with a ›', async () => {
  const { user } = await renderMobileApp();
  await openMenu(user);
  const rows = within(drawer()).getAllByRole('menuitem');
  expect(rows.map((r) => r.textContent!.replace('›', ''))).toEqual(MENU_ORDER);
  for (const r of rows) {
    expect(r).toHaveClass('m-tap');
    expect(r.textContent).toContain('›');
  }
});

it('drills into a menu and back, one level at a time, and a submenu one level further', async () => {
  const { user } = await renderMobileApp();
  await openMenu(user, 'View');
  expect(within(drawer()).getByRole('heading', { name: 'View' })).toBeInTheDocument();
  expect(screen.queryByRole('menuitem', { name: 'File' })).toBeNull();
  await user.click(screen.getByRole('menuitem', { name: 'Theme' }));
  expect(within(drawer()).getByRole('heading', { name: 'Theme' })).toBeInTheDocument();
  expect(screen.getAllByRole('menuitemradio').map((r) => r.textContent!.replace('✓', ''))).toEqual(['Light', 'Dark', 'Auto']);
  await user.click(screen.getByRole('button', { name: 'Back to menus' }));
  expect(within(drawer()).getByRole('heading', { name: 'View' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Back to menus' }));
  expect(screen.getByRole('menuitem', { name: 'File' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Back to menus' })).toBeNull();
});

it('lists every command with a menu except exactly the excluded ones, across the whole tree', async () => {
  const { user } = await newDoc();
  const seen: string[] = [];
  await openMenu(user);
  const menus = within(drawer()).getAllByRole('menuitem').map((r) => r.textContent!.replace('›', ''));
  for (const [i, name] of menus.entries()) {
    if (i > 0) await user.click(screen.getByRole('button', { name: 'Back to menus' }));
    await user.click(screen.getByRole('menuitem', { name }));
    const subs = [...document.querySelectorAll<HTMLElement>('[data-submenu]:not(:disabled)')].map((e) => e.getAttribute('data-submenu')!);
    for (const id of subs) {
      await user.click(document.querySelector<HTMLElement>(`[data-submenu="${id}"]`)!);
      for (const el of document.querySelectorAll('[data-command]')) seen.push(el.getAttribute('data-command')!);
      await user.click(screen.getByRole('button', { name: 'Back to menus' }));
    }
    for (const el of document.querySelectorAll('[data-command]')) seen.push(el.getAttribute('data-command')!);
  }
  const expected = registry
    .commands()
    .filter((c) => c.menu !== undefined && c.kind !== 'submenu' && !EXCLUDED_COMMAND_IDS.includes(c.id))
    .map((c) => c.id);
  // Dynamic submenu items (Open Recent) have synthetic ids; the registered commands must all be there.
  for (const id of expected) expect(seen).toContain(id);
  for (const id of EXCLUDED_COMMAND_IDS) expect(seen).not.toContain(id);
  expect(screen.queryByText(/Connect to Server|Close Tab/)).toBeNull();
});

it('shows Close Tab on the desktop registry but not in the mobile File menu', async () => {
  expect(registry.commands().some((c) => c.id === 'file.closeTab' && c.menu === 'file')).toBe(true);
  const { user } = await newDoc();
  await openMenu(user, 'File');
  expect(screen.queryByRole('menuitem', { name: /Close Tab/ })).toBeNull();
  expect(screen.queryByRole('menuitem', { name: /Connect to Server/ })).toBeNull();
});

it('shows the Format menu disabled with no document, and its items enabled with one', async () => {
  const r = await renderMobileApp();
  const { user } = r;
  await openMenu(user);
  expect(screen.getByRole('menuitem', { name: 'Format' })).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Close menu' }));
  await newDoc(r);
  await openMenu(user, 'Format');
  expect(within(drawer()).getAllByRole('menuitem').length).toBeGreaterThan(3);
});

it('shows disabled commands disabled, never hidden, and no shortcut hints', async () => {
  const { user } = await renderMobileApp();
  await openMenu(user, 'File');
  expect(screen.getByRole('menuitem', { name: 'Save' })).toBeDisabled();
  expect(drawer().textContent).not.toMatch(/Ctrl|⌘|⌥/);
  for (const row of drawer().querySelectorAll('[data-command]')) expect(row).toHaveClass('m-tap');
});

it('Raw Markdown is a checkbox that flips; a pick closes the drawer and runs the command', async () => {
  const { user } = await newDoc();
  await openMenu(user, 'View');
  expect(screen.getByRole('menuitemcheckbox', { name: 'Raw Markdown' })).toHaveAttribute('aria-checked', 'false');
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Raw Markdown' }));
  expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
  await openMenu(user, 'View');
  expect(screen.getByRole('menuitemcheckbox', { name: 'Raw Markdown' })).toHaveAttribute('aria-checked', 'true');
});

it('reopens at the menu list after a close', async () => {
  const { user } = await renderMobileApp();
  await openMenu(user, 'View');
  await user.click(screen.getByRole('button', { name: 'Close menu' }));
  expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
  await openMenu(user);
  expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument();
});

it('closes with the scrim', async () => {
  const { user } = await renderMobileApp();
  await openMenu(user);
  await user.click(screen.getByTestId('menu-scrim'));
  expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
});

it('closes with Back one level at a time, then leaves the screen as it was', async () => {
  const { user } = await renderMobileApp();
  await openMenu(user, 'View', 'Theme');
  await back();
  expect(within(drawer()).getByRole('heading', { name: 'View' })).toBeInTheDocument();
  await back();
  expect(screen.getByRole('menuitem', { name: 'View' })).toBeInTheDocument();
  await back();
  expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
  expect(screen.getByRole('img', { name: 'Gonq' })).toBeInTheDocument();
});

it('looks different from the Outline drawer and gives the close and back controls a tap area', async () => {
  const { user } = await newDoc();
  await openMenu(user, 'View');
  expect(drawer().tagName).toBe('ASIDE');
  expect(drawer()).toHaveClass('m-menu-drawer');
  expect(drawer()).not.toHaveClass('m-drawer');
  for (const name of ['Close menu', 'Back to menus']) expect(screen.getByRole('button', { name })).toHaveClass('m-tap');
});

it('blurs the editor when it opens, so the keyboard goes down', async () => {
  const { user } = await newDoc();
  const content = document.querySelector<HTMLElement>('.cm-content')!;
  content.focus();
  await openMenu(user);
  expect(document.activeElement).not.toBe(content);
});
