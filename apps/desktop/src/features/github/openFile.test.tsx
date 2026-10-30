/** Opening GitHub files in tabs: github:// identity and routing, recorded metadata, duplicate/branch tabs, recents, error wording, Save on an unchanged tab, the web-build error and text fidelity. */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from '../../App';
import { menu } from '../../testing/renderApp';
import { settleEditors } from '@gonq/editor/testing/editor';
import { openGithub, type FileAccess } from '@gonq/editor/platform/files';
import { githubPath, parseGithubPath, readFile } from '@gonq/editor/platform/github';

let recentRows: { path: string; opened_at: number }[] = [];
const reads: Record<string, unknown> = {};
const invoke = vi.fn(async (cmd: string, args?: Record<string, unknown>): Promise<unknown> => {
  if (cmd === 'recent_documents_list') return recentRows;
  if (cmd === 'recent_documents_add') {
    recentRows = [{ path: args!.path as string, opened_at: 1 }, ...recentRows.filter((r) => r.path !== args!.path)];
    return recentRows;
  }
  if (cmd === 'recent_documents_remove') return recentRows;
  if (cmd === 'take_launch_paths') return [];
  if (cmd === 'github_status') return { signed_in: true, login: 'me', storage: 'keychain' };
  if (cmd === 'github_list_branches') return { default_branch: 'main', branches: ['main', 'dev'], next_page: null };
  if (cmd === 'github_list_folder') return { entries: [{ name: 'a.md', path: 'docs/a.md', kind: 'file' }], truncated: false };
  if (cmd === 'github_read_file') {
    const key = `${args!.branch}:${args!.path}`;
    const r = reads[key];
    if (r instanceof Error) throw r;
    if (r !== undefined && typeof r === 'object' && 'kind' in (r as object)) throw r;
    if (r === undefined) throw { kind: 'path_not_found' };
    return r;
  }
  return undefined;
});
vi.mock('@gonq/editor/platform/bindings', async () => (await import('@gonq/editor/testing/mockBindings')).bindingsMock((...a: [string, Record<string, unknown>?]) => invoke(...a)));
vi.mock('@gonq/editor/platform/lifecycle', () => ({ guardClose: () => () => {} }));
vi.mock('@gonq/editor/platform/openPaths', () => ({ takePendingOpenPaths: async () => [], listenOpenPaths: () => () => {} }));
vi.mock('@tauri-apps/plugin-dialog', () => ({ open: vi.fn(), save: vi.fn() }));

const file = (path: string, content: string, sha = 'blob1', commit = 'tip1') => ({
  path,
  name: path.split('/').pop(),
  content,
  sha,
  commit_sha: commit,
});
const loc = { owner: 'octo', repo: 'notes' };
const gh = (branch: string, path: string) => githubPath({ ...loc, branch, path });

beforeEach(() => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  recentRows = [];
  for (const k of Object.keys(reads)) delete reads[k];
  invoke.mockClear();
});
afterEach(() => {
  cleanup();
  delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
});

function setup(files: Partial<FileAccess> = {}) {
  const saveDocument = vi.fn(async (d: { name: string; path: string | null }) => ({ name: d.name, path: d.path }));
  const f: FileAccess = {
    pickDocument: async () => null,
    saveDocument,
    saveDocumentAs: async () => null,
    openPath: openGithub,
    ...files,
  };
  const user = userEvent.setup();
  render(<App files={f} />);
  return { user, saveDocument };
}

async function openRecent(user: ReturnType<typeof userEvent.setup>, name: string | RegExp) {
  await user.click(await screen.findByRole('button', { name: /^Folder navigator/ }).catch(() => screen.getByTitle('Folder navigator')));
  await user.click(await screen.findByRole('button', { name }));
}

describe('github:// identity', () => {
  it('round-trips branches with slashes and paths with spaces, @, % and unicode', () => {
    const l = { owner: 'o', repo: 'r', branch: 'feature/ü x', path: 'a b/ü@50%.md' };
    const p = githubPath(l);
    expect(p).toBe('github://o/r@feature%2F%C3%BC%20x/a%20b/%C3%BC%4050%25.md');
    expect(parseGithubPath(p)).toEqual(l);
  });

  it('openGithub routes a github:// path to github_read_file and rebuilds the identity from the response', async () => {
    reads['feat/x:docs/ü file.md'] = file('docs/ü file.md', '# Hi', 'sha-from-api', 'tip-from-api');
    const doc = await openGithub(gh('feat/x', 'docs/ü file.md'));
    expect(invoke).toHaveBeenCalledWith('github_read_file', { owner: 'octo', repo: 'notes', branch: 'feat/x', path: 'docs/ü file.md' });
    expect(doc).toMatchObject({
      name: 'ü file.md',
      path: gh('feat/x', 'docs/ü file.md'),
      text: '# Hi',
      github: { owner: 'octo', repo: 'notes', branch: 'feat/x', path: 'docs/ü file.md', sha: 'sha-from-api', commitSha: 'tip-from-api' },
    });
  });

  it('records the path GitHub reports, not the one asked for', async () => {
    reads['main:readme.md'] = file('README.md', 'x');
    const doc = await openGithub(gh('main', 'readme.md'));
    expect(doc.github?.path).toBe('README.md');
    expect(doc.path).toBe(gh('main', 'README.md'));
  });

  it('keeps CRLF, a BOM and an empty file exactly as GitHub sent them', async () => {
    reads['main:crlf.md'] = file('crlf.md', '﻿a\r\nb\r\n');
    reads['main:empty.md'] = file('empty.md', '');
    expect((await openGithub(gh('main', 'crlf.md'))).text).toBe('﻿a\r\nb\r\n');
    expect((await openGithub(gh('main', 'empty.md'))).text).toBe('');
  });

  it('rejects a malformed github path', async () => {
    await expect(openGithub('github://nope')).rejects.toThrow(/not a GitHub file address/);
  });
});

describe('web build', () => {
  it('readFile throws the desktop-app error and calls nothing', async () => {
    delete (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__;
    await expect(readFile('o', 'r', 'main', 'a.md')).rejects.toMatchObject({ kind: 'unavailable_on_web', message: expect.stringMatching(/desktop app/) });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('error wording', () => {
  const cases: [string, Record<string, unknown>, RegExp][] = [
    ['not_found', { kind: 'path_not_found' }, /not found.*private repository/s],
    ['branch gone', { kind: 'branch_not_found' }, /Branch dev .* deleted/],
    ['no access', { kind: 'no_access', message: 'SAML enforced' }, /refused access.*SAML enforced/],
    ['folder', { kind: 'not_a_file' }, /is a folder/],
    ['symlink', { kind: 'symlink' }, /symbolic link/],
    ['submodule', { kind: 'submodule' }, /submodule/],
    ['too large', { kind: 'file_too_large' }, /over 1 MB.*never opens a cut-off copy/],
    ['rate limit', { kind: 'rate_limited', reset_at: 1_900_000_000, message: 'x' }, /rate limit reached\. Try again after /],
    ['offline', { kind: 'network', message: 'dns' }, /offline/],
  ];
  it.each(cases)('%s', async (_n, err, re) => {
    reads['dev:a.md'] = err;
    await expect(openGithub(gh('dev', 'a.md'))).rejects.toThrow(re);
  });
});

describe('in the app', () => {
  it('opens from recents, shows the file name with owner/repo and branch in the tooltip, and switches the navigator', async () => {
    reads['dev:docs/a.md'] = file('docs/a.md', '# Alpha\n\nbody text');
    recentRows = [{ path: gh('dev', 'docs/a.md'), opened_at: Date.now() }];
    const { user } = setup();
    await openRecent(user, /^a\.md/);
    const tab = await screen.findByRole('tab', { name: /a\.md/ });
    expect(tab).toHaveAttribute('title', 'octo/notes @ dev\ndocs/a.md');
    await screen.findByText('body text');
    // The navigator now shows the recent's repository and branch.
    expect(await screen.findByText('octo/notes')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Branch: dev' })).toBeInTheDocument();
    expect(invoke).toHaveBeenCalledWith('recent_documents_add', { path: gh('dev', 'docs/a.md') });
    expect(invoke).not.toHaveBeenCalledWith('allow_recent_document', expect.anything());
  });

  it('focuses the existing tab for the same file and branch, and opens a second tab for another branch', async () => {
    reads['main:docs/a.md'] = file('docs/a.md', 'on main');
    reads['dev:docs/a.md'] = file('docs/a.md', 'on dev');
    recentRows = [
      { path: gh('main', 'docs/a.md'), opened_at: 2 },
      { path: gh('dev', 'docs/a.md'), opened_at: 1 },
    ];
    const { user } = setup();
    await openRecent(user, /^a\.md.*octo\/notes @ main/);
    await screen.findByText('on main');
    const reads1 = invoke.mock.calls.filter((c) => c[0] === 'github_read_file').length;
    await user.click(screen.getByRole('button', { name: /^a\.md.*octo\/notes @ main/ }));
    await waitFor(() => expect(screen.getAllByRole('tab')).toHaveLength(1));
    expect(invoke.mock.calls.filter((c) => c[0] === 'github_read_file')).toHaveLength(reads1);
    await user.click(screen.getByRole('button', { name: /^a\.md.*octo\/notes @ dev/ }));
    await screen.findByText('on dev');
    expect(screen.getAllByRole('tab')).toHaveLength(2);
    expect(screen.getByRole('tab', { name: /a\.md \(main\)/ })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /a\.md \(dev\)/ })).toBeInTheDocument();
  });

  it('shows the error in the banner and opens no tab', async () => {
    reads['main:docs/a.md'] = { kind: 'file_too_large' };
    recentRows = [{ path: gh('main', 'docs/a.md'), opened_at: 1 }];
    const { user } = setup();
    await openRecent(user, /^a\.md/);
    expect(await screen.findByText(/over 1 MB/)).toBeInTheDocument();
    expect(screen.queryByRole('tab')).not.toBeInTheDocument();
  });

  it('not signed in: runs the sign-in, then reads again', async () => {
    reads['main:docs/a.md'] = { kind: 'not_signed_in' };
    recentRows = [{ path: gh('main', 'docs/a.md'), opened_at: 1 }];
    let status: { signed_in: boolean; login: string | null; storage: string | null } = { signed_in: false, login: null, storage: null };
    const base = invoke.getMockImplementation()!;
    invoke.mockImplementation(async (cmd, args) => {
      if (cmd === 'take_launch_paths') return [];
  if (cmd === 'github_status') return status;
      return base(cmd, args);
    });
    const { user } = setup();
    // The sign-in dialog is not rendered by this test's registry hook: signing in is simulated by the handler.
    const { setSignInHandler } = await import('@gonq/editor/platform/github');
    setSignInHandler(async () => {
      status = { signed_in: true, login: 'me', storage: 'keychain' };
      reads['main:docs/a.md'] = file('docs/a.md', 'after sign-in');
      return true;
    });
    await openRecent(user, /^a\.md/);
    await screen.findByText('after sign-in');
    invoke.mockImplementation(base);
  });

  it('Save on an unchanged GitHub tab commits nothing and says so', async () => {
    reads['main:docs/a.md'] = file('docs/a.md', '# A\n\ntext');
    recentRows = [{ path: gh('main', 'docs/a.md'), opened_at: 1 }];
    const { user, saveDocument } = setup();
    await openRecent(user, /^a\.md/);
    await screen.findByText('text');
    await settleEditors(document.body);
    await menu(user, 'File', /^Save(?!\s*As)/);
    expect(await screen.findByText('No changes to commit')).toBeInTheDocument();
    expect(saveDocument).not.toHaveBeenCalled();
    expect(invoke.mock.calls.some((c) => /write|save|commit/i.test(String(c[0])))).toBe(false);
  });
});
