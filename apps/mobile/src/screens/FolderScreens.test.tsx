/** Covers the mobile local-folder flows end to end on the fake SAF plugin: Open Folder… (cancel is silent, the picked folder becomes the navigator root and a local:// recent), the web/desktop error in the banner, reopening a recent (revoked and missing grants: banner text, recent removed, no dialog), opening a file from the navigator, Save in place, the Cancel/Overwrite conflict sheet, Save as inside a folder (name prompt, `exists`) and outside one (system create-document), and that no tab title, tooltip or recent shows a storage path. */
import { screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
import { fakeSafPlugin } from '@gonq/editor/testing/mockBindings';
import { settleEditors, type as typeText } from '@gonq/editor/testing/editor';

const saf = fakeSafPlugin();
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (cmd: string, args?: Record<string, unknown>) => (cmd.startsWith('plugin:gonq-saf|') ? saf.invoke(cmd, args) : Promise.resolve(undefined)) }));
vi.mock('@gonq/editor/platform/bindings', async () =>
  (await import('@gonq/editor/testing/mockBindings')).bindingsMock((c, a) => invoke(c, a)),
);

import { renderMobileApp, type User } from '../testing/renderMobileApp';

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2Fnotes';
let recents: { path: string; opened_at: number }[] = [];

beforeEach(() => {
  recents = [];
  saf.calls.length = 0;
  saf.granted.clear();
  saf.nextPick = null;
  saf.nextDocument = null;
  invoke.mockReset().mockImplementation(async (cmd: string, args?: { path?: string }) => {
    if (cmd === 'recent_documents_list') return recents;
    if (cmd === 'recent_documents_add') return (recents = [{ path: args!.path!, opened_at: Date.now() }, ...recents.filter((r) => r.path !== args!.path)]);
    if (cmd === 'recent_documents_remove') return (recents = recents.filter((r) => r.path !== args?.path));
    if (cmd === 'github_status') return { signed_in: false, login: null, storage: 'keychain' };
    return undefined;
  });
  saf.addTree(TREE, { 'a.md': '# a', 'docs/': '', 'docs/b.md': '# b' });
});

const sheet = () => screen.getByRole('dialog', { name: 'Folder navigator' });
async function menu(user: User, item: string) {
  await user.click(screen.getByRole('button', { name: 'More' }));
  await user.click(await screen.findByRole('menuitem', { name: item }));
}
/** Opens the folder through Open Folder… and the file `name` from the sheet. */
async function openFile(name: string): Promise<User> {
  saf.nextPick = { tree: TREE, name: 'notes' };
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Folder…' }));
  await user.click(await within(await screen.findByRole('dialog', { name: 'Folder navigator' })).findByRole('button', { name }));
  await screen.findByRole('tab', { name: new RegExp(name.replace('.', '\\.')) });
  await settleEditors(document.body);
  return user;
}

it('cancelling the system picker returns silently: no banner, no recent, no sheet', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Folder…' }));
  await waitFor(() => expect(saf.calls.map(([c]) => c)).toContain('local_pick_folder'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.queryByRole('dialog')).toBeNull();
  expect(recents).toEqual([]);
});

it('File > Open Folder… in the ⋯ menu runs the same flow', async () => {
  saf.nextPick = { tree: TREE, name: 'notes' };
  const { user } = await renderMobileApp();
  await menu(user, 'Open Folder…');
  expect(await screen.findByRole('dialog', { name: 'Folder navigator' })).toBeInTheDocument();
  expect(await within(sheet()).findByText('a.md')).toBeInTheDocument();
});

it('outside the Gonq Android app Open Folder… shows the platform error in the banner and the control stays enabled', async () => {
  const { user } = await renderMobileApp();
  const tauri = (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
  try {
    const open = screen.getByRole('button', { name: 'Open Folder…' });
    expect(open).toBeEnabled();
    await user.click(open);
    expect(await screen.findByRole('alert')).toHaveTextContent('Folders on this device can only be opened in the Gonq app for Android.');
    expect(open).toBeEnabled();
  } finally {
    (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = tauri;
  }
});

it('reopening the folder from recents opens the navigator on it', async () => {
  saf.nextPick = { tree: TREE, name: 'notes' };
  const { user, unmount } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Folder…' }));
  await within(await screen.findByRole('dialog', { name: 'Folder navigator' })).findByText('a.md');
  unmount();
  const again = await renderMobileApp();
  await again.user.click(await screen.findByRole('button', { name: /^notes/ }));
  expect(await within(await screen.findByRole('dialog', { name: 'Folder navigator' })).findByText('a.md')).toBeInTheDocument();
});

it('a revoked grant on reopen: banner with the platform text, the recent is removed, no dialog', async () => {
  saf.nextPick = { tree: TREE, name: 'notes' };
  const first = await renderMobileApp();
  await first.user.click(screen.getByRole('button', { name: 'Open Folder…' }));
  await within(await screen.findByRole('dialog', { name: 'Folder navigator' })).findByText('a.md');
  first.unmount();
  saf.revoke(TREE);
  const { user } = await renderMobileApp();
  await user.click(await screen.findByRole('button', { name: /^notes/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Access to this folder was removed. Open it again to continue.');
  expect(screen.queryByRole('dialog')).toBeNull();
  await waitFor(() => expect(recents).toEqual([]));
});

it('a file recent in a revoked folder: banner, the recent is removed', async () => {
  const path = `local://${encodeURIComponent(TREE)}/a.md`;
  recents = [{ path, opened_at: Date.now() }];
  saf.revoke(TREE);
  const { user } = await renderMobileApp();
  await user.click(await screen.findByRole('button', { name: /^a\.md/ }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Access to this folder was removed.');
  await waitFor(() => expect(recents).toEqual([]));
});

it('opens a file from the navigator; the tab shows the file name, never a storage path', async () => {
  const user = await openFile('a.md');
  const tab = screen.getByRole('tab', { name: /a\.md/ });
  expect(tab.getAttribute('title')).toBe('notes/a.md');
  expect(document.body.textContent).not.toMatch(/storage|content:\/\//);
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  expect(within(sheet()).getByRole('button', { name: 'a.md' })).toHaveAttribute('aria-current', 'true');
});

it('Save writes in place', async () => {
  const user = await openFile('a.md');
  typeText('X');
  await menu(user, 'Save');
  await waitFor(() => expect(saf.text(TREE, 'a.md')).toBe('X# a'));
  await waitFor(() => expect(screen.queryByTitle('Unsaved changes')).toBeNull());
});

it('a file changed behind our back asks Cancel / Overwrite: Cancel keeps the changes unsaved, Overwrite writes them', async () => {
  const user = await openFile('a.md');
  typeText('X');
  saf.tick();
  saf.put(TREE, 'a.md', '# changed elsewhere');
  await menu(user, 'Save');
  let sheetEl = await screen.findByRole('dialog', { name: /changed on the server since you opened it/ });
  await user.click(within(sheetEl).getByRole('button', { name: 'Cancel' }));
  expect(saf.text(TREE, 'a.md')).toBe('# changed elsewhere');
  expect(screen.getByTitle('Unsaved changes')).toBeInTheDocument();
  await menu(user, 'Save');
  sheetEl = await screen.findByRole('dialog', { name: /changed on the server since you opened it/ });
  await user.click(within(sheetEl).getByRole('button', { name: 'Overwrite' }));
  await waitFor(() => expect(saf.text(TREE, 'a.md')).toBe('X# a'));
});

it('Save as inside an opened folder asks for a name, creates the file next to the document and handles `exists`', async () => {
  const user = await openFile('a.md');
  await menu(user, 'Save As…');
  const prompt = await screen.findByRole('dialog', { name: 'Save as' });
  const name = within(prompt).getByRole('textbox', { name: 'File name' });
  expect(name).toHaveValue('a.md');
  // The same name is taken: said in the prompt, nothing is overwritten, the prompt stays.
  await user.click(within(prompt).getByRole('button', { name: 'Save' }));
  expect(await within(prompt).findByRole('alert')).toHaveTextContent('a.md already exists in notes.');
  expect(saf.text(TREE, 'a.md')).toBe('# a');
  await user.clear(name);
  await user.type(name, 'copy');
  await user.click(within(prompt).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(saf.text(TREE, 'copy.md')).toBe('# a'));
  expect(screen.queryByRole('dialog', { name: 'Save as' })).toBeNull();
  expect(await screen.findByRole('tab', { name: /copy\.md/ })).toBeInTheDocument();
  expect(recents.some((r) => r.path.endsWith('/copy.md'))).toBe(true);
});

it('Save as rejects an empty name or one with a slash in the prompt', async () => {
  const user = await openFile('a.md');
  await menu(user, 'Save As…');
  const prompt = await screen.findByRole('dialog', { name: 'Save as' });
  const name = within(prompt).getByRole('textbox', { name: 'File name' });
  await user.clear(name);
  expect(within(prompt).getByRole('alert')).toHaveTextContent('Enter a name');
  expect(within(prompt).getByRole('button', { name: 'Save' })).toBeDisabled();
  await user.type(name, 'a/b');
  expect(within(prompt).getByRole('alert')).toHaveTextContent('A name cannot contain');
});

it('Save as with no folder open uses the system create-document picker and writes into the new document', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'New' }));
  await settleEditors(document.body);
  typeText('hello');
  const doc = 'content://com.android.externalstorage.documents/document/primary%3ADocuments%2Fnew.md';
  saf.nextDocument = { uri: doc, name: 'new.md' };
  await menu(user, 'Save As…');
  await waitFor(() => expect(saf.text(doc, '')).toBe('hello'));
  expect(saf.calls.map(([c]) => c)).toContain('local_create_document');
  expect(await screen.findByRole('tab', { name: /new\.md/ })).toBeInTheDocument();
  expect(screen.queryByRole('dialog', { name: 'Save as' })).toBeNull();
});

it('cancelling the create-document picker leaves the document unsaved with no message', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'New' }));
  await settleEditors(document.body);
  typeText('hello');
  await menu(user, 'Save As…');
  await waitFor(() => expect(saf.calls.map(([c]) => c)).toContain('local_create_document'));
  expect(screen.queryByRole('alert')).toBeNull();
  expect(screen.getByRole('tab', { name: /Untitled\.md/ })).toBeInTheDocument();
});
