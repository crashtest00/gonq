/** The View, Insert and Help menus registered by their feature modules: items, enabled state and the CommandContext actions they call. */
import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { MenuBar } from '../components/MenuBar';
import type { CommandContext } from '@gonq/editor/commands';

function setup(over: Partial<CommandContext> = {}) {
  const ctx = {
    hasDocument: true,
    canUndo: false,
    canRedo: false,
    raw: false,
    theme: 'auto',
    tableTarget: null,
    editor: { current: { focus: vi.fn() } },
    setRaw: vi.fn(),
    setTheme: vi.fn(),
    insertImage: vi.fn(),
    insertToc: vi.fn(),
    openAgentSkill: vi.fn(),
    openAbout: vi.fn(),
    ...over,
  } as unknown as CommandContext;
  render(<MenuBar ctx={ctx} />);
  return ctx;
}

test('menus come in order File, Edit, View, Insert, Format, Help', () => {
  setup();
  const names = screen.getAllByRole('menuitem').map((i) => i.textContent);
  expect(names).toEqual(['File', 'Edit', 'View', 'Insert', 'Format', 'Help']);
});

test('View > Raw Markdown shows the mode and toggles it; disabled without a document', async () => {
  const ctx = setup({ raw: true });
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  const raw = await screen.findByRole('menuitemcheckbox', { name: /Raw Markdown/ });
  expect(raw).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(raw);
  expect(ctx.setRaw).toHaveBeenCalledWith(false);
});

test('View > Raw Markdown is disabled with no document', async () => {
  setup({ hasDocument: false });
  await userEvent.setup().click(screen.getByRole('menuitem', { name: 'View' }));
  expect(await screen.findByRole('menuitemcheckbox', { name: 'Raw Markdown' })).toHaveAttribute('data-disabled');
});

test('View > Theme selects the current theme and sets another', async () => {
  const ctx = setup({ theme: 'dark' });
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: 'View' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Theme' }));
  expect(await screen.findByRole('menuitemradio', { name: /Dark/ })).toHaveAttribute('aria-checked', 'true');
  fireEvent.click(screen.getByRole('menuitemradio', { name: /Light/ }));
  expect(ctx.setTheme).toHaveBeenCalledWith('light');
});

test('Insert items call the context actions and are disabled without a document', async () => {
  const ctx = setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: 'Insert' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Image…' }));
  expect(ctx.insertImage).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('menuitem', { name: 'Insert' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Table of Contents' }));
  expect(ctx.insertToc).toHaveBeenCalledTimes(1);
});

test('Insert items are disabled with no document', async () => {
  setup({ hasDocument: false });
  await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Insert' }));
  expect(await screen.findByRole('menuitem', { name: 'Image…' })).toHaveAttribute('data-disabled');
  expect(screen.getByRole('menuitem', { name: 'Table of Contents' })).toHaveAttribute('data-disabled');
});

test('Help opens the agent skill and About dialogs', async () => {
  const ctx = setup();
  const user = userEvent.setup();
  await user.click(screen.getByRole('menuitem', { name: 'Help' }));
  await user.click(await screen.findByRole('menuitem', { name: 'Agent skill…' }));
  expect(ctx.openAgentSkill).toHaveBeenCalledTimes(1);
  await user.click(screen.getByRole('menuitem', { name: 'Help' }));
  await user.click(await screen.findByRole('menuitem', { name: 'About Gonq' }));
  expect(ctx.openAbout).toHaveBeenCalledTimes(1);
});
