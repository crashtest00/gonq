/** Covers the mobile ⋯ menu through renderMobileApp: every registry command with a `menu` is in the tree except exactly EXCLUDED_COMMAND_IDS, the whole tree as a snapshot (no document and with one), disabled commands shown disabled, check/radio rows, no shortcut hints, and picking a row running its command. */
import { screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { registry } from '@gonq/editor/commands';
import { EXCLUDED_COMMAND_IDS } from '../excludedCommands';
import { renderMobileApp } from '../testing/renderMobileApp';

beforeEach(() => {
  localStorage.clear();
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve([]);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    return Promise.resolve(undefined);
  });
});

/** The open sheet as text: menu headings, `---` separators, `[group]` for submenus, `(disabled)` and `(checked)` flags. */
function dump(): string[] {
  const sheet = screen.getByRole('dialog', { name: 'Menu' });
  const out: string[] = [];
  for (const menu of within(sheet).getAllByRole('menu')) {
    out.push(`# ${menu.getAttribute('aria-label')}`);
    for (const el of menu.querySelectorAll('[role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="separator"], [role="group"]')) {
      const role = el.getAttribute('role');
      if (role === 'separator') out.push('---');
      else if (role === 'group') out.push(`[${el.getAttribute('aria-label')}]`);
      else {
        const flags = `${(el as HTMLButtonElement).disabled ? ' (disabled)' : ''}${el.getAttribute('aria-checked') === 'true' ? ' (checked)' : ''}`;
        out.push(`${role === 'menuitem' ? '' : `${role!.replace('menuitem', '')}: `}${el.textContent!.replace('✓', '')}${flags}`);
      }
    }
  }
  return out;
}

it('lists every command with a menu except exactly the excluded ones, in the registry', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'More' }));
  const shown = [...document.querySelectorAll('[data-command]')].map((e) => e.getAttribute('data-command'));
  const expected = registry
    .commands()
    .filter((c) => c.menu !== undefined && c.kind !== 'submenu' && !EXCLUDED_COMMAND_IDS.includes(c.id))
    .map((c) => c.id);
  expect([...shown].sort()).toEqual([...expected].sort());
  expect(registry.commands().filter((c) => c.menu !== undefined && EXCLUDED_COMMAND_IDS.includes(c.id)).map((c) => c.id)).toEqual([...EXCLUDED_COMMAND_IDS]);
  expect(screen.queryByText(/Connect to Server/)).toBeNull();
  for (const name of [/^Outline/, /^Comments/, /Find/]) expect(screen.queryByRole('menuitem', { name })).toBeNull();
});

it('shows the whole tree without a document: disabled, never hidden', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'More' }));
  expect(dump()).toMatchSnapshot();
});

it('shows the whole tree with a document open', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'New' }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  await user.click(screen.getByRole('button', { name: 'More' }));
  expect(dump()).toMatchSnapshot();
});

it('shows no shortcut hints and gives every row a 44px tap class', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'More' }));
  const sheet = screen.getByRole('dialog', { name: 'Menu' });
  expect(sheet.textContent).not.toMatch(/Ctrl|⌘|⌥/);
  for (const row of sheet.querySelectorAll('[data-command]')) expect(row).toHaveClass('m-tap');
});

it('Raw Markdown is a checkbox that flips, Theme is a radio group, and a pick closes the sheet', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'New' }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  await user.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('menuitemcheckbox', { name: 'Raw Markdown' })).toHaveAttribute('aria-checked', 'false');
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Raw Markdown' }));
  expect(screen.queryByRole('dialog', { name: 'Menu' })).toBeNull();
  await user.click(screen.getByRole('button', { name: 'More' }));
  expect(screen.getByRole('menuitemcheckbox', { name: 'Raw Markdown' })).toHaveAttribute('aria-checked', 'true');
  expect(within(screen.getByRole('group', { name: 'Theme' })).getAllByRole('menuitemradio').map((r) => r.textContent!.replace('✓', ''))).toEqual(['Light', 'Dark', 'Auto']);
});

it('Open Folder… and Open Repo… are listed; Open Folder… says it is not available yet', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(screen.getByRole('menuitem', { name: 'Open Folder…' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('not available yet');
});
