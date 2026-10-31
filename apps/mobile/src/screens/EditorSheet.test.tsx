/** Covers the mobile long-press editor sheet through renderMobileApp: it opens after a held touch on the text (not a short tap, a move or a mouse press), lists the registry's context-menu commands in order with dividers, disabled states, no Insert link… and no shortcut hints, runs a command, and never prevents the default of the touch. */
import { createEvent, fireEvent, screen, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { settleEditors } from '@gonq/editor/testing/editor';
import { renderMobileApp } from '../testing/renderMobileApp';
import { LONG_PRESS_MS } from './EditorSheet';

beforeEach(() => {
  invoke.mockReset().mockImplementation((cmd: string) => {
    if (cmd === 'recent_documents_list') return Promise.resolve([]);
    if (cmd === 'github_status') return Promise.resolve({ signed_in: false, login: null, storage: 'keychain' });
    return Promise.resolve(undefined);
  });
});

async function openNew() {
  const app = await renderMobileApp();
  await app.user.click(screen.getByRole('button', { name: 'New' }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  await settleEditors(document.body);
  return app;
}

const content = () => document.querySelector<HTMLElement>('.cm-content')!;
function pointer(type: string, init: { pointerType?: string; clientX?: number; clientY?: number } = {}) {
  const e = createEvent(type, content(), { bubbles: true, cancelable: true });
  Object.defineProperties(e, {
    pointerType: { value: init.pointerType ?? 'touch' },
    isPrimary: { value: true },
    clientX: { value: init.clientX ?? 10 },
    clientY: { value: init.clientY ?? 10 },
  });
  fireEvent(content(), e);
  return e;
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const sheet = () => screen.queryByRole('dialog', { name: 'Editor' });

function dump(): string[] {
  const menu = within(screen.getByRole('dialog', { name: 'Editor' })).getByRole('menu', { name: 'Editor' });
  return [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((el) =>
    el.getAttribute('role') === 'separator' ? '---' : `${el.textContent}${(el as HTMLButtonElement).disabled ? ' (disabled)' : ''}`,
  );
}

it('opens after a held touch and lists the desktop right-click items in order, with dividers', async () => {
  await openNew();
  const down = pointer('pointerdown');
  await wait(LONG_PRESS_MS + 100);
  expect(down.defaultPrevented).toBe(false);
  await screen.findByRole('dialog', { name: 'Editor' });
  expect(dump()).toEqual(['Add Comment (disabled)', '---', 'Cut (disabled)', 'Copy (disabled)', 'Paste', '---', 'Select All', '---', 'Bold', 'Italic']);
  expect(screen.queryByRole('menuitem', { name: /Insert link/ })).toBeNull();
  expect(sheet()!.textContent).not.toMatch(/Ctrl|Alt\+|⌘/);
  for (const b of within(sheet()!).getAllByRole('menuitem')) expect(b).toHaveClass('m-tap');
});

it('does not open for a short tap, a moving finger or a mouse', async () => {
  await openNew();
  pointer('pointerdown');
  pointer('pointerup');
  await wait(LONG_PRESS_MS + 100);
  expect(sheet()).toBeNull();
  pointer('pointerdown');
  pointer('pointermove', { clientX: 60 });
  await wait(LONG_PRESS_MS + 100);
  expect(sheet()).toBeNull();
  pointer('pointerdown', { pointerType: 'mouse' });
  await wait(LONG_PRESS_MS + 100);
  expect(sheet()).toBeNull();
});

it('runs the picked command and closes; Cut and Copy enable with a selection', async () => {
  const { user } = await openNew();
  await user.click(content());
  await user.keyboard('hello');
  await user.keyboard('{Shift>}{Home}{/Shift}');
  pointer('pointerdown');
  await screen.findByRole('dialog', { name: 'Editor' }, { timeout: 2000 });
  expect(dump()).toContain('Cut');
  expect(dump()).toContain('Copy');
  await user.click(screen.getByRole('menuitem', { name: 'Bold' }));
  expect(sheet()).toBeNull();
  expect(content().textContent).toContain('hello');
});
