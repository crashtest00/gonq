/** Covers the mobile Folder navigator sheet through renderMobileApp and the fake SAF plugin, porting FolderSidebar.test.tsx and NavigatorRefresh.test.tsx: top-bar button, "Project folder" / base-name title / "No folder open" with disabled Refresh and Open Folder…, rows (folders and Markdown only, no dotfiles, folders first, A-Z), Loading…, "No Markdown files." / "Empty.", aria-current, Refresh (always rendered, busy, re-lists in place, same DOM nodes, kept rows on failure), revoked and missing grants on Refresh, and 44px hit areas. */
import { act, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, expect, it, vi } from 'vitest';

vi.hoisted(() => ((window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {}));
import { fakeSafPlugin } from '@gonq/editor/testing/mockBindings';

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
  invoke.mockReset().mockImplementation(async (cmd: string, args?: { path?: string }) => {
    if (cmd === 'recent_documents_list') return recents;
    if (cmd === 'recent_documents_add') return (recents = [{ path: args!.path!, opened_at: Date.now() }, ...recents.filter((r) => r.path !== args!.path)]);
    if (cmd === 'recent_documents_remove') return (recents = recents.filter((r) => r.path !== args?.path));
    if (cmd === 'github_status') return { signed_in: false, login: null, storage: 'keychain' };
    return undefined;
  });
  saf.addTree(TREE, {
    'meetings/': '',
    'meetings/sync.md': '# sync',
    'meetings/empty/': '',
    'Zed.md': '# z',
    'alpha.md': '# a',
    '.hidden.md': 'x',
    'notes.txt': 'x',
    'pic.png': 'x',
  });
});

async function openFolder(): Promise<User> {
  saf.nextPick = { tree: TREE, name: 'notes' };
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Open Folder…' }));
  await screen.findByRole('dialog', { name: 'Folder navigator' });
  return user;
}
const sheet = () => screen.getByRole('dialog', { name: 'Folder navigator' });
const refresh = () => within(sheet()).getByRole('button', { name: 'Refresh' });
const deferred = () => {
  let resolve!: (v: unknown) => void;
  const p = new Promise((res) => (resolve = res));
  return { p, resolve };
};

it('with nothing open the sheet says "No folder open", has a disabled Refresh and Open Folder…', async () => {
  const { user } = await renderMobileApp();
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  const s = sheet();
  expect(within(s).getByText('Project folder')).toBeInTheDocument();
  expect(within(s).getByText('No folder open')).toBeInTheDocument();
  expect(refresh()).toBeDisabled();
  expect(within(s).getByRole('button', { name: 'Open Folder…' })).toBeEnabled();
});

it('Open Folder… opens the sheet on the folder: base name title, folders first, A-Z ignoring case, no dotfiles or non-Markdown', async () => {
  await openFolder();
  const s = sheet();
  expect(within(s).getByText('Project folder')).toBeInTheDocument();
  expect(within(s).getByText('notes')).toBeInTheDocument();
  expect(document.body.textContent).not.toMatch(/primary|content:|storage/);
  const rows = (await within(s).findAllByRole('button')).map((b) => b.textContent!.replace(/[▸▾▫]/g, ''));
  expect(rows.slice(rows.indexOf('meetings'))).toEqual(['meetings', 'alpha.md', 'Zed.md']);
  expect(within(s).queryByText('.hidden.md')).toBeNull();
  expect(within(s).queryByText('notes.txt')).toBeNull();
  expect(within(s).queryByText('pic.png')).toBeNull();
  expect(refresh()).toBeEnabled();
});

it('adds the folder to recents as local:// and shows it there by name', async () => {
  const user = await openFolder();
  await waitFor(() => expect(recents[0].path).toMatch(/^local:\/\//));
  await user.click(within(sheet()).getAllByRole('button', { name: 'Close' })[0]);
  expect(await screen.findByRole('button', { name: /^notes/ })).toBeInTheDocument();
});

it('shows "Empty." for an empty subfolder and "No Markdown files." for an empty folder', async () => {
  const user = await openFolder();
  await user.click(await within(sheet()).findByRole('button', { name: /meetings/ }));
  await user.click(await within(sheet()).findByRole('button', { name: /^.*empty$/ }));
  expect(await within(sheet()).findByText('Empty.')).toBeInTheDocument();
  const other = 'content://x/tree/primary%3Adrafts';
  saf.addTree(other, {});
  saf.nextPick = { tree: other, name: 'drafts' };
  await user.click(within(sheet()).getByRole('button', { name: 'Close' }));
  await user.click(screen.getByRole('button', { name: 'Open Folder…' }));
  expect(await screen.findByText('No Markdown files.')).toBeInTheDocument();
});

it('shows Loading… while the first listing runs', async () => {
  const gate = deferred();
  const real = saf.invoke.bind(saf);
  vi.spyOn(saf, 'invoke').mockImplementation(async (cmd, args) => {
    if (cmd.endsWith('local_list')) await gate.p;
    return real(cmd, args);
  });
  await openFolder();
  expect(within(sheet()).getByText('Loading…')).toBeInTheDocument();
  await act(async () => gate.resolve(null));
  expect(await within(sheet()).findByText('alpha.md')).toBeInTheDocument();
  vi.restoreAllMocks();
});

it('Refresh re-lists in place: expanded folder, current-file mark and untouched rows keep their DOM nodes', async () => {
  const user = await openFolder();
  await user.click(await within(sheet()).findByRole('button', { name: /meetings/ }));
  const sync = await within(sheet()).findByRole('button', { name: 'sync.md' });
  const meetings = within(sheet()).getByRole('button', { name: /meetings/ });
  const alpha = within(sheet()).getByRole('button', { name: 'alpha.md' });
  await user.click(alpha); // opens alpha.md and closes the sheet
  await screen.findByRole('tab', { name: /alpha\.md/ });
  await user.click(screen.getByRole('button', { name: 'Folder navigator' }));
  expect(within(sheet()).getByRole('button', { name: 'alpha.md' })).toHaveAttribute('aria-current', 'true');
  saf.put(TREE, 'new.md', '# n');
  saf.put(TREE, 'meetings/second.md', '# s');
  await user.click(refresh());
  await within(sheet()).findByRole('button', { name: 'new.md' });
  await within(sheet()).findByRole('button', { name: 'second.md' });
  expect(within(sheet()).getByRole('button', { name: /meetings/ })).toBe(meetings);
  expect(within(sheet()).getByRole('button', { name: 'sync.md' })).toBe(sync);
  expect(within(sheet()).getByRole('button', { name: 'alpha.md' })).toBe(alpha);
  expect(meetings).toHaveAttribute('aria-expanded', 'true');
  await waitFor(() => expect(refresh()).toBeEnabled());
});

it('Refresh is disabled and busy while listing, and a second tap does nothing', async () => {
  const user = await openFolder();
  await within(sheet()).findByText('alpha.md');
  const gate = deferred();
  const real = saf.invoke.bind(saf);
  vi.spyOn(saf, 'invoke').mockImplementation(async (cmd, args) => {
    if (cmd.endsWith('local_list')) await gate.p;
    return real(cmd, args);
  });
  await user.click(refresh());
  await waitFor(() => expect(refresh()).toBeDisabled());
  expect(refresh()).toHaveAttribute('aria-busy', 'true');
  await user.click(refresh());
  await act(async () => gate.resolve(null));
  await waitFor(() => expect(refresh()).toBeEnabled());
  expect(saf.calls.filter(([c]) => c === 'local_list')).toHaveLength(2);
  vi.restoreAllMocks();
});

it('a failed re-list keeps the rows and says "Could not refresh: …"', async () => {
  const user = await openFolder();
  await within(sheet()).findByText('alpha.md');
  const real = saf.invoke.bind(saf);
  vi.spyOn(saf, 'invoke').mockImplementation(async (cmd, args) => (cmd.endsWith('local_list') ? Promise.reject({ kind: 'io', message: 'Provider is busy' }) : real(cmd, args)));
  await user.click(refresh());
  expect(await within(sheet()).findByText(/Could not refresh: Provider is busy/)).toBeInTheDocument();
  expect(within(sheet()).getByText('alpha.md')).toBeInTheDocument();
  vi.restoreAllMocks();
});

it('Refresh with a revoked grant: error banner with the platform text, the recent is removed, no dialog', async () => {
  const user = await openFolder();
  await within(sheet()).findByText('alpha.md');
  await waitFor(() => expect(recents).toHaveLength(1));
  saf.revoke(TREE);
  await user.click(refresh());
  expect(await screen.findByRole('alert')).toHaveTextContent('Access to this folder was removed. Open it again to continue.');
  expect(recents).toHaveLength(0);
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('Refresh with the folder moved away: banner with the platform text and the recent is removed', async () => {
  const user = await openFolder();
  await within(sheet()).findByText('alpha.md');
  saf.vanish(TREE);
  await user.click(refresh());
  expect(await screen.findByRole('alert')).toHaveTextContent('The opened folder is no longer available.');
  await waitFor(() => expect(recents).toHaveLength(0));
});

it('every control in the sheet is at least 44x44 CSS px (the .m-tap rule) and rows do not clip silently', async () => {
  await openFolder();
  const s = sheet();
  await within(s).findByText('alpha.md');
  for (const b of within(s).getAllByRole('button')) expect(b).toHaveClass(/m-tap/);
  expect(within(s).getByRole('group', { name: 'Files' })).toHaveClass('m-hscroll');
});
