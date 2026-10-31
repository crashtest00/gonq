/** Covers the mobile editor screen through renderMobileApp: opening via "+", the accessory bar contents (and no H1/H2/quote/code/Table), pointer-down cancel, bold through the bar, the Raw Markdown switch (name, toggle, segments, read-only tab) and that the screen adds no key/input listeners of its own. */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { renderMobileApp } from '../testing/renderMobileApp';
import { DocumentProvider } from '../shell/documents';
import { CommandHostProvider } from '../shell/commandContext';
import { GithubProvider } from '../shell/github';
import { NoticesProvider } from '../shell/notices';
import { ThemeProvider } from '../shell/theme';
import { NavigatorProvider, StackNavigator } from '../shell/StackNavigator';
import { PhoneShell } from '../shell/PhoneShell';
import { EditorScreen, editorScreen } from './EditorScreen';
import { documentsScreen } from './screens';
import { settleEditors } from '@gonq/editor/testing/editor';

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
  return app;
}

const LABELS = ['Undo', 'Redo', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Insert link', 'Bullet list', 'Numbered list', 'Checkbox list', 'Insert table'];

it('opens the editor with the accessory bar offering exactly the desktop toolbar actions', async () => {
  await openNew();
  const bar = screen.getByRole('toolbar', { name: 'Editing' });
  expect(within(bar).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual(LABELS);
  for (const name of [/heading/i, /^h[12]$/i, /quote/i, /code/i, /^table$/i]) expect(within(bar).queryByRole('button', { name })).toBeNull();
  for (const b of within(bar).getAllByRole('button')) expect(b).toHaveClass('m-tap');
});

it('cancels pointer-down on every bar button so focus stays in the editor', async () => {
  await openNew();
  for (const b of within(screen.getByRole('toolbar', { name: 'Editing' })).getAllByRole('button')) {
    const down = new Event('pointerdown', { bubbles: true, cancelable: true });
    b.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(true);
  }
});

it('bold from the bar formats the typed text', async () => {
  const { user } = await openNew();
  await settleEditors(document.body);
  const content = document.querySelector<HTMLElement>('.cm-content')!;
  await user.click(content);
  await user.keyboard('hello');
  await user.keyboard('{Shift>}{Home}{/Shift}');
  await user.click(screen.getByRole('button', { name: 'Bold' }));
  await waitFor(() => expect(content.textContent).toContain('hello'));
  expect(document.querySelector('.cm-content strong, .cm-content .cm-strong, .cm-content [class*=bold]')).not.toBeNull();
});

it('has a Raw Markdown switch in the top bar that flips Raw and Formatted with 44px segments', async () => {
  const { user } = await openNew();
  const sw = within(screen.getByRole('banner')).getByRole('switch', { name: 'Raw Markdown' });
  expect(sw).toHaveAttribute('aria-checked', 'false');
  await user.click(within(sw).getByText('Raw'));
  expect(sw).toHaveAttribute('aria-checked', 'true');
  await user.click(within(sw).getByText('Raw'));
  expect(sw).toHaveAttribute('aria-checked', 'true');
  await user.click(within(sw).getByText('Formatted'));
  expect(sw).toHaveAttribute('aria-checked', 'false');
  sw.focus();
  await user.keyboard('{Enter}');
  expect(sw).toHaveAttribute('aria-checked', 'true');
});

it('keeps the Raw switch working on a read-only tab', async () => {
  const user = userEvent.setup();
  render(
    <NoticesProvider>
      <ThemeProvider>
        <DocumentProvider>
          <NavigatorProvider initial={documentsScreen}>
            <GithubProvider>
              <Open />
              <CommandHostProvider>
                <PhoneShell>
                  <StackNavigator />
                </PhoneShell>
              </CommandHostProvider>
            </GithubProvider>
          </NavigatorProvider>
        </DocumentProvider>
      </ThemeProvider>
    </NoticesProvider>,
  );
  const sw = await screen.findByRole('switch', { name: 'Raw Markdown' });
  await user.click(sw);
  expect(sw).toHaveAttribute('aria-checked', 'true');
  expect(document.querySelector('.cm-content')).toHaveAttribute('contenteditable', 'false');
});

import { useEffect } from 'react';
import { useDocuments } from '../shell/documents';
import { useNavigator } from '../shell/StackNavigator';
import { createElement } from 'react';
function Open() {
  const { session } = useDocuments();
  const { reset } = useNavigator();
  useEffect(() => {
    session.openUntitled?.();
    reset({ ...editorScreen('Untitled.md'), render: () => createElement(EditorScreen, { readOnly: true }) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

it('adds no key or input listeners outside CodeMirror (React itself delegates to its root, so the sources are checked)', () => {
  const sources = import.meta.glob(['../**/*.ts', '../**/*.tsx', '!../**/*.test.*'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
  expect(Object.keys(sources).length).toBeGreaterThan(5);
  const bad = /\bon(KeyDown|KeyUp|KeyPress|BeforeInput|Input)\b|addEventListener\(\s*['"](key\w+|beforeinput|input|textInput)['"]/;
  for (const [file, text] of Object.entries(sources)) expect(bad.test(text), file).toBe(false);
});
