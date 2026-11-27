/** Covers the top-bar Comments button's on/off state (`data-active` beside `aria-expanded`, always equal) through renderMobileApp: off at start, on after the button, a marker tap, off after Close, the button, Android Back (list, draft Cancel/Back, thread), in a document with no comments, and on a read-only GitHub PR tab. */
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
const invoke = vi.fn();
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);
const disk = vi.hoisted(() => ({ text: '' }));
vi.mock('@tauri-apps/plugin-fs', async (orig) => ({
  ...(await orig<object>()),
  readFile: vi.fn(async () => new TextEncoder().encode(disk.text)),
  writeTextFile: vi.fn(async () => {}),
}));
let backHandler: (() => void) | null = null;
vi.mock('@gonq/editor/platform/backButton', () => ({
  onAndroidBack: (h: () => void) => {
    backHandler = h;
    return () => {};
  },
  leaveApp: async () => {},
  hasBackButton: () => true,
}));

import { clearSessionBranches } from '@gonq/editor/features/github/sessionBranches';
import { editorView, settleEditors } from '@gonq/editor/testing/editor';
import { renderMobileApp } from '../testing/renderMobileApp';

const A = 'c20260910143022a3f9c1';
const DOC = `Para one [💬](#md-thread-${A}) here.\n\n<!--\n@thread ${A}\n@status open\n\n[User | 2026-09-10T14:30:22+02:00]\nFirst?\n-->\n`;
const back = () => act(async () => backHandler?.());
const sheet = () => screen.getByRole('dialog', { name: 'Comments' });
const inSheet = () => within(sheet());
const editor = () => document.querySelector<HTMLElement>('.cm-content')!;
const button = () => screen.getByRole('button', { name: 'Comments' });

/** The attribute and aria-expanded must always agree, so every state is asserted through this. */
function expectState(on: boolean) {
  expect(button()).toHaveAttribute('data-active', String(on));
  expect(button()).toHaveAttribute('aria-expanded', String(on));
  if (on) expect(screen.getByRole('dialog', { name: 'Comments' })).toBeInTheDocument();
  else expect(screen.queryByRole('dialog', { name: 'Comments' })).toBeNull();
}

beforeEach(() => {
  backHandler = null;
  clearSessionBranches();
  invoke.mockReset().mockImplementation(async (cmd: string, a: Record<string, unknown>) => {
    switch (cmd) {
      case 'recent_documents_list':
        return [{ path: '/d/a.md', opened_at: Date.now() }];
      case 'github_status':
        return { signed_in: false, login: null, storage: 'keychain' };
      case 'path_exists':
        return true;
      default:
        return undefined;
    }
  });
});

async function openDoc(text: string) {
  disk.text = text;
  const app = await renderMobileApp();
  await app.user.click(await screen.findByRole('button', { name: /^a\.md/ }));
  await screen.findByRole('toolbar', { name: 'Editing' });
  await settleEditors(document.body);
  return app;
}

it('is off at start, on after the button opens the list, off after the button closes it', async () => {
  const { user } = await openDoc(DOC);
  expectState(false);
  await user.click(button());
  await screen.findByRole('dialog', { name: 'Comments' });
  expectState(true);
  await user.click(button());
  expectState(false);
});

it('turns on when a marker tap opens the thread, and off after Close', async () => {
  const { user } = await openDoc(DOC);
  await waitFor(() => expect(editor().querySelectorAll('.cm-thread-marker')).toHaveLength(1));
  await user.click(editor().querySelector('.cm-thread-marker')!);
  await inSheet().findByRole('button', { name: 'Close thread' });
  expectState(true);
  await user.click(inSheet().getByRole('button', { name: 'Close' }));
  expectState(false);
});

it('Back closes the list and the thread view and turns the button off', async () => {
  const { user } = await openDoc(DOC);
  await user.click(button());
  await screen.findByRole('dialog', { name: 'Comments' });
  await back();
  expectState(false);
  await user.click(button());
  await user.click(await inSheet().findByRole('button', { name: /First\?/ }));
  expectState(true);
  await back();
  expectState(false);
});

it('stays on while a draft is open; Cancel returns to the list (still on) and Back from the draft too', async () => {
  const { user } = await openDoc(DOC);
  await user.click(button());
  await user.click(await inSheet().findByRole('button', { name: 'Add comment' }));
  await screen.findByRole('textbox', { name: 'Comment' });
  expectState(true);
  await user.click(inSheet().getByRole('button', { name: 'Cancel' }));
  await inSheet().findByRole('button', { name: 'Add comment' });
  expectState(true);
  await user.click(inSheet().getByRole('button', { name: 'Add comment' }));
  await screen.findByRole('textbox', { name: 'Comment' });
  await back();
  await inSheet().findByRole('button', { name: 'Add comment' });
  expectState(true);
  await back();
  expectState(false);
});

it('works in a document with no comments', async () => {
  const { user } = await openDoc('Hello world.\n');
  expectState(false);
  await user.click(button());
  await inSheet().findByText('No comments yet.');
  expectState(true);
  await user.click(button());
  expectState(false);
});

it('works on a read-only GitHub pull request tab', async () => {
  invoke.mockImplementation(async (cmd: string, a: Record<string, unknown>) => {
    switch (cmd) {
      case 'github_status':
        return { signed_in: true, login: 'octo', storage: 'keychain' };
      case 'github_list_repos':
        return { repos: [{ owner: 'o', name: 'r', full_name: 'o/r', private: false, default_branch: 'main', can_push: true, pushed_at: null }], next_page: null };
      case 'github_list_branches':
        return { default_branch: 'main', branches: ['main'], next_page: null };
      case 'github_list_folder':
        return { entries: [{ name: 'a.md', path: 'docs/a.md', kind: 'file' }], truncated: false };
      case 'github_read_file':
        return { path: a.path, name: 'a.md', content: 'The estimate holds through Q3.\n', sha: 'blob1', commit_sha: 'tip1' };
      case 'github_open_pulls_for_branches':
        return (a.branches as string[]).map((b) => ({ branch: b, pull: { number: 12, html_url: 'https://github.com/o/r/pull/12', draft: false, title: null } }));
      default:
        return [];
    }
  });
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Repo…' }));
  await user.click(await screen.findByRole('button', { name: /o\/r/ }));
  await user.click(await screen.findByRole('button', { name: 'a.md' }));
  await screen.findByTestId('read-only-banner');
  await settleEditors(document.body);
  await waitFor(() => expect(editorView().state.readOnly).toBe(true));
  expectState(false);
  await user.click(button());
  await screen.findByRole('dialog', { name: 'Comments' });
  expectState(true);
  await user.click(button());
  expectState(false);
});
