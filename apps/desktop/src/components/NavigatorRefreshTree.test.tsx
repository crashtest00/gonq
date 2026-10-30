/** Navigator Refresh on a real tree (only invoke is mocked): rows that did not change keep their DOM nodes (so scroll, expansion and the highlight survive) while renames, deletes and new files show; Tab/Enter/Space reach the button; the branch dropdown lists branches added upstream; a plain refresh never calls onBranchChange. */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FolderSidebar } from './FolderSidebar';
import { RepoNavigator } from './RepoNavigator';

type Args = Record<string, unknown> | undefined;
const invoke = vi.fn<(cmd: string, args?: Args) => Promise<unknown>>();
vi.mock('../platform/bindings', async () => (await import('../testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
});
afterEach(() => {
  cleanup();
  invoke.mockReset();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

const noop = () => {};
const file = (dir: string, name: string) => ({ name, path: `${dir}/${name}`, is_dir: false });

/** A local tree: a docs folder, 10 filler files, keep.md (the open file), and files that change on the second listing. */
function localTree(v: 1 | 2) {
  const fillers = Array.from({ length: 10 }, (_, i) => file('/proj', `f${String(i).padStart(3, '0')}.md`));
  return {
    '/proj': [
      { name: 'docs', path: '/proj/docs', is_dir: true },
      ...fillers,
      file('/proj', 'keep.md'),
      ...(v === 1 ? [file('/proj', 'gone.md'), file('/proj', 'before.md')] : [file('/proj', 'after.md'), file('/proj', 'added.md')]),
    ],
    '/proj/docs': v === 1 ? [file('/proj/docs', 'inner-old.md')] : [file('/proj/docs', 'inner-new.md')],
  } as Record<string, unknown>;
}

function mockLocal() {
  let v: 1 | 2 = 1;
  invoke.mockImplementation(async (cmd, args) => {
    if (cmd !== 'list_directory') throw new Error(`unexpected ${cmd}`);
    return localTree(v)[args!.path as string];
  });
  return () => {
    v = 2;
  };
}

const renderLocal = () =>
  render(
    <FolderSidebar folder="/proj" recents={[]} currentPath="/proj/keep.md" onOpenFolder={noop} onOpenFile={noop} onOpenRecent={noop} onRemoveRecent={noop} />,
  );

it('local refresh shows renamed, deleted and added files and keeps expanded folder, highlight, scroll and untouched rows in place', async () => {
  const toV2 = mockLocal();
  const user = userEvent.setup();
  const { container } = renderLocal();
  await user.click(await screen.findByRole('button', { name: /docs/ }));
  await screen.findByText('inner-old.md');
  const nav = container.querySelector('nav') as HTMLElement;
  nav.scrollTop = 900;
  const docs = screen.getByRole('button', { name: /docs/ });
  const keep = screen.getByRole('button', { name: 'keep.md' });
  const far = screen.getByRole('button', { name: 'f009.md' });
  expect(keep).toHaveAttribute('aria-current', 'true');

  toV2();
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('added.md');
  await screen.findByText('inner-new.md');

  expect(screen.getByText('after.md')).toBeInTheDocument(); // renamed
  expect(screen.queryByText('before.md')).toBeNull();
  expect(screen.queryByText('gone.md')).toBeNull(); // deleted
  expect(screen.queryByText('inner-old.md')).toBeNull();
  // The very same DOM nodes: nothing was remounted, so a real browser keeps scroll, focus and expansion.
  expect(container.querySelector('nav')).toBe(nav);
  expect(screen.getByRole('button', { name: /docs/ })).toBe(docs);
  expect(docs).toHaveAttribute('aria-expanded', 'true');
  expect(screen.getByRole('button', { name: 'keep.md' })).toBe(keep);
  expect(screen.getByRole('button', { name: 'f009.md' })).toBe(far);
  expect(keep).toHaveAttribute('aria-current', 'true');
  expect(container.querySelectorAll('[aria-current="true"]')).toHaveLength(1);
  expect(within(nav).getAllByRole('button', { name: /^f\d{3}\.md$/ })).toHaveLength(10);
  expect(nav.scrollTop).toBe(900);
});

it('the Refresh button is reached with Tab and starts a refresh with Enter and with Space', async () => {
  mockLocal();
  const user = userEvent.setup();
  renderLocal();
  await screen.findByText('keep.md');
  const refresh = screen.getByRole('button', { name: 'Refresh' });
  const listings = () => invoke.mock.calls.filter((c) => c[0] === 'list_directory').length;
  // Tab from the Project folder header lands on Refresh (the header toggle is the only stop before it).
  screen.getByRole('button', { name: 'Project folder' }).focus();
  await user.tab();
  expect(refresh).toHaveFocus();

  for (const key of ['{Enter}', ' ']) {
    const before = listings();
    await user.keyboard(key);
    await waitFor(() => expect(listings()).toBe(before + 1));
    await waitFor(() => expect(refresh).toBeEnabled());
    refresh.focus();
  }
});

it('a plain GitHub refresh lists a branch added upstream in the dropdown and never calls onBranchChange', async () => {
  let branches = ['main', 'dev'];
  invoke.mockImplementation(async (cmd) => {
    if (cmd === 'github_list_branches') return { default_branch: 'main', branches, next_page: null };
    if (cmd === 'github_list_folder') return { entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false };
    throw new Error(`unexpected ${cmd}`);
  });
  const onBranchChange = vi.fn();
  const user = userEvent.setup();
  render(<RepoNavigator repo={{ owner: 'o', repo: 'r', branch: 'dev' }} currentPath={null} onBranchChange={onBranchChange} onOpenFile={noop} />);
  await screen.findByText('a.md');
  await user.click(screen.getByRole('button', { name: 'Branch: dev' }));
  expect(within(await screen.findByRole('listbox', { name: 'Branches' })).queryByText('hotfix')).toBeNull();
  await user.keyboard('{Escape}');

  branches = ['main', 'dev', 'hotfix'];
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Refresh' })).toBeEnabled());
  await user.click(screen.getByRole('button', { name: 'Branch: dev' }));
  expect(await within(await screen.findByRole('listbox', { name: 'Branches' })).findByText('hotfix')).toBeInTheDocument();
  expect(onBranchChange).not.toHaveBeenCalled();
});

it('a GitHub refresh keeps the nav and the untouched rows as the same DOM nodes', async () => {
  const entries = (v: number) => [
    ...Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.md`, path: `f${i}.md`, kind: 'file' })),
    { name: v === 1 ? 'old.md' : 'new.md', path: v === 1 ? 'old.md' : 'new.md', kind: 'file' },
  ];
  let v = 1;
  invoke.mockImplementation(async (cmd) =>
    cmd === 'github_list_branches' ? { default_branch: 'main', branches: ['main'], next_page: null } : { entries: entries(v), truncated: false },
  );
  const user = userEvent.setup();
  const { container } = render(
    <FolderSidebar folder={null} repo={{ owner: 'o', repo: 'r', branch: 'main' }} recents={[]} currentPath="o/r@main/f5.md" onOpenFolder={noop} onOpenFile={noop} onOpenRecent={noop} onRemoveRecent={noop} />,
  );
  await screen.findByText('old.md');
  const nav = container.querySelector('nav') as HTMLElement;
  nav.scrollTop = 500;
  const row = screen.getByRole('button', { name: /^f9\.md/ });
  v = 2;
  await user.click(screen.getByRole('button', { name: 'Refresh' }));
  await screen.findByText('new.md');
  expect(screen.queryByText('old.md')).toBeNull();
  expect(container.querySelector('nav')).toBe(nav);
  expect(screen.getByRole('button', { name: /^f9\.md/ })).toBe(row);
  expect(nav.scrollTop).toBe(500);
});
