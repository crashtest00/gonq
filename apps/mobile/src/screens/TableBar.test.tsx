/** Covers the mobile table bar through renderMobileApp (ported from the desktop TableToolbar.test.tsx): the Table / Formatting toolbar switch, all ten ops in desktop order, disabled and pressed state from the target, running an op, 44px .m-tap buttons, and release when focus leaves. */
import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { settleEditors } from '@gonq/editor/testing/editor';
import { renderMobileApp } from '../testing/renderMobileApp';

beforeEach(() => {
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve([]);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    return Promise.resolve(undefined);
  });
});

const OPS = [
  'Insert row above', 'Insert row below', 'Insert column left', 'Insert column right',
  'Align column left', 'Align column center', 'Align column right',
  'Delete row', 'Delete column', 'Delete table',
];

/** Opens a new document, inserts a table and returns the app with a cell focused. */
async function inTable() {
  const app = await renderMobileApp();
  await app.user.click(screen.getByRole('button', { name: 'New' }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  await settleEditors(document.body);
  await app.user.click(document.querySelector<HTMLElement>('.cm-content')!);
  await app.user.click(screen.getByRole('button', { name: 'Insert table' }));
  await settleEditors(document.body);
  await waitFor(() => expect(cells().length).toBeGreaterThan(0));
  act(() => cells()[0].focus());
  await screen.findByRole('button', { name: 'Table' });
  return app;
}

const cells = () => document.querySelectorAll<HTMLElement>('.cm-content td');

it('shows the Table button only while the caret is in a table, and swaps the bars both ways', async () => {
  const { user } = await inTable();
  expect(screen.getByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Table' }));
  const bar = screen.getByRole('toolbar', { name: 'Table' });
  expect(screen.queryByRole('toolbar', { name: 'Editing' })).toBeNull();
  expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(['Formatting toolbar', ...OPS]);
  await user.click(within(bar).getByRole('button', { name: 'Formatting toolbar' }));
  expect(screen.getByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();
  expect(within(screen.getByRole('toolbar', { name: 'Editing' })).getByRole('button', { name: 'Bold' })).toBeInTheDocument();
});

it('every table-bar button is an .m-tap and cancels pointer-down', async () => {
  const { user } = await inTable();
  await user.click(screen.getByRole('button', { name: 'Table' }));
  for (const b of within(screen.getByRole('toolbar', { name: 'Table' })).getAllByRole('button')) {
    expect(b).toHaveClass('m-tap');
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    b.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  }
});

it('disabled and pressed state come from the target', async () => {
  const { user } = await inTable();
  cells()[0].focus();
  await user.click(screen.getByRole('button', { name: 'Table' }));
  const bar = screen.getByRole('toolbar', { name: 'Table' });
  for (const name of ['Align column left', 'Align column center', 'Align column right']) {
    expect(within(bar).getByRole('button', { name })).toHaveAttribute('aria-pressed');
  }
  expect(within(bar).queryAllByRole('button', { pressed: true })).toHaveLength(0);
  expect(within(bar).getByRole('button', { name: 'Insert row above' })).toBeEnabled();
  await user.click(within(bar).getByRole('button', { name: 'Align column center' }));
  await settleEditors(document.body);
  await waitFor(() => expect(within(screen.getByRole('toolbar', { name: 'Table' })).getByRole('button', { name: 'Align column center' })).toHaveAttribute('aria-pressed', 'true'));
});

it('Insert row below adds a row', async () => {
  const { user } = await inTable();
  const before = document.querySelectorAll('.cm-content tr').length;
  await user.click(screen.getByRole('button', { name: 'Table' }));
  await user.click(screen.getByRole('button', { name: 'Insert row below' }));
  await settleEditors(document.body);
  await waitFor(() => expect(document.querySelectorAll('.cm-content tr').length).toBe(before + 1));
});

it('releasing focus away from the table brings the formatting bar back', async () => {
  const { user } = await inTable();
  await user.click(screen.getByRole('button', { name: 'Table' }));
  fireEvent.focusOut(cells()[0], { relatedTarget: null });
  await waitFor(() => expect(screen.getByRole('toolbar', { name: 'Editing' })).toBeInTheDocument());
  expect(screen.queryByRole('button', { name: 'Table' })).toBeNull();
});

it('re-entering the table after leaving it shows the formatting bar with the Table button, not the table bar', async () => {
  const { user } = await inTable();
  await user.click(screen.getByRole('button', { name: 'Table' }));
  act(() => cells()[0].blur());
  await waitFor(() => expect(screen.queryByRole('button', { name: 'Table' })).toBeNull());
  act(() => cells()[0].focus());
  await screen.findByRole('button', { name: 'Table' });
  expect(screen.getByRole('toolbar', { name: 'Editing' })).toBeInTheDocument();
  expect(screen.queryByRole('toolbar', { name: 'Table' })).toBeNull();
});
