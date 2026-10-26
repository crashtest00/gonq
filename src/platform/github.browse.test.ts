/** github.ts browsing: listBranches/listFolder wrappers, error kinds, github:// path format, web error. */
import { vi } from 'vitest';

let tauri = true;
const invoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
vi.mock('./files', () => ({ isTauri: () => tauri }));

import { githubPath, isGithubPath, listBranches, listFolder, parseGithubPath, toGitHubError } from './github';

beforeEach(() => {
  tauri = true;
  invoke.mockReset();
});

describe('listBranches', () => {
  it('maps the page to camelCase', async () => {
    invoke.mockResolvedValue({ default_branch: 'main', branches: ['main', 'dev'], next_page: 2 });
    expect(await listBranches('o', 'r', 1)).toEqual({ defaultBranch: 'main', branches: ['main', 'dev'], nextPage: 2 });
    expect(invoke).toHaveBeenCalledWith('github_list_branches', { owner: 'o', repo: 'r', page: 1 });
  });
  it('throws unavailable_on_web on the web', async () => {
    tauri = false;
    await expect(listBranches('o', 'r', 1)).rejects.toMatchObject({ kind: 'unavailable_on_web' });
    expect(invoke).not.toHaveBeenCalled();
  });
});

describe('listFolder', () => {
  it('passes owner, repo, branch and path and returns the listing', async () => {
    const entries = [{ name: 'a.md', path: 'docs/a.md', kind: 'file' }];
    invoke.mockResolvedValue({ entries, truncated: true });
    expect(await listFolder('o', 'r', 'feat/x', 'docs')).toEqual({ entries, truncated: true });
    expect(invoke).toHaveBeenCalledWith('github_list_folder', { owner: 'o', repo: 'r', branch: 'feat/x', path: 'docs' });
  });
  it('throws unavailable_on_web on the web', async () => {
    tauri = false;
    await expect(listFolder('o', 'r', 'main', '')).rejects.toMatchObject({ kind: 'unavailable_on_web' });
  });
  it.each(['not_signed_in', 'branch_not_found', 'path_not_found', 'not_a_folder', 'empty_repo', 'network'])('maps the %s error kind', async (kind) => {
    invoke.mockRejectedValue({ kind });
    await expect(listFolder('o', 'r', 'main', '')).rejects.toMatchObject({ name: 'GitHubError', kind });
  });
  it('keeps the rate-limit reset time', () => {
    const e = toGitHubError({ kind: 'rate_limited', reset_at: 1_800_000_000, message: 'slow down' });
    expect(e.kind).toBe('rate_limited');
    expect(e.resetAt).toBe(1_800_000_000);
  });
});

describe('github:// paths', () => {
  const at = { owner: 'octo', repo: 'notes', branch: 'main', path: '' };
  it('formats the root and nested paths', () => {
    expect(githubPath(at)).toBe('github://octo/notes@main');
    expect(githubPath({ ...at, path: 'docs/a.md' })).toBe('github://octo/notes@main/docs/a.md');
    expect(isGithubPath('github://octo/notes@main')).toBe(true);
    expect(isGithubPath('ssh://h/x')).toBe(false);
  });
  it.each(['feature/ünï-ß', 'a@b', '100%', 'with space', 'x/y/z', '日本語/ブランチ'])('round-trips the branch %s', (branch) => {
    const p = githubPath({ ...at, branch, path: 'dir @1/ü 100%.md' });
    expect(p.slice('github://octo/notes@'.length).split('/')[0]).not.toContain('/');
    expect(parseGithubPath(p)).toEqual({ ...at, branch, path: 'dir @1/ü 100%.md' });
  });
  it('rejects malformed paths', () => {
    expect(parseGithubPath('github://octo')).toBeNull();
    expect(parseGithubPath('github://octo/notes@%E0%A4%A')).toBeNull();
    expect(parseGithubPath('/local/path')).toBeNull();
  });
});
