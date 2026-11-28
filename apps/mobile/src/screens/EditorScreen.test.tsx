/** Covers the mobile editor screen through renderMobileApp: opening via "+", the accessory bar contents (and no H1/H2/quote/code/Table), pointer-down cancel, bold through the bar, Save first in the bar, no Raw switch in the top bar, Raw Markdown via More on a read-only tab and that the screen adds no key/input listeners of its own. */
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { openMenu } from '../testing/menu';
import { renderMobileApp } from '../testing/renderMobileApp';
import { DocumentProvider } from '../shell/documents';
import { CommandHostProvider } from '../shell/commandContext';
import { CommentsProvider } from '../shell/comments';
import { DialogsProvider } from '../shell/dialogs';
import { OutlineProvider } from '../shell/outline';
import { GithubProvider } from '../shell/github';
import { FolderProvider } from '../shell/folder';
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

const LABELS = ['Save', 'Undo', 'Redo', 'Bold', 'Italic', 'Underline', 'Strikethrough', 'Insert link', 'Bullet list', 'Numbered list', 'Checkbox list', 'Insert table'];

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

it('has no Raw switch in the top bar and Save is the first button of the accessory bar', async () => {
  await openNew();
  expect(screen.queryByRole('switch', { name: 'Raw Markdown' })).toBeNull();
  const bar = screen.getByRole('toolbar', { name: 'Editing' });
  expect(within(bar).getAllByRole('button')[0]).toHaveAccessibleName('Save');
});

it('keeps Raw Markdown in the More menu working on a read-only tab', async () => {
  const user = userEvent.setup();
  render(
    <NoticesProvider>
      <ThemeProvider>
        <DialogsProvider>
        <DocumentProvider>
          <NavigatorProvider initial={documentsScreen}>
            <FolderProvider>
            <GithubProvider>
              <Open />
              <CommentsProvider>
                <CommandHostProvider>
                  <OutlineProvider>
                    <PhoneShell>
                      <StackNavigator />
                    </PhoneShell>
                  </OutlineProvider>
                </CommandHostProvider>
              </CommentsProvider>
            </GithubProvider>
            </FolderProvider>
          </NavigatorProvider>
        </DocumentProvider>
        </DialogsProvider>
      </ThemeProvider>
    </NoticesProvider>,
  );
  await screen.findByRole('toolbar', { name: 'Editing' });
  await openMenu(user, 'View');
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Raw Markdown' }));
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
