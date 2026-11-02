import { expect, test, type Locator, type Page } from '@playwright/test';

// The mobile Open PR flow (review, details and result screens) on the Pixel profile (project `mobile`): every button,
// link, select and field has a hit area of at least 44x44 CSS px and the page does not scroll sideways. A stub Tauri
// invoke answers the GitHub commands; the open tab's branch (main) is the one branch to merge from.

async function stubBackend(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      transformCallback: () => 0,
      invoke: async (cmd: string, args: Record<string, unknown> = {}) => {
        switch (cmd.replace('plugin:gonq|', '')) {
          case 'github_status':
            return { signed_in: true, login: 'octo', storage: 'keychain' };
          case 'github_list_repos':
            return { repos: [{ owner: 'octo', name: 'notes', full_name: 'octo/notes', private: false, default_branch: 'main', can_push: true, pushed_at: null }], next_page: null };
          case 'github_list_folder':
            return { entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false };
          case 'github_list_branches':
            return { default_branch: 'main', branches: ['main', 'dev', 'release/a-rather-long-branch-name-for-the-wrapping'], next_page: null };
          case 'github_read_file':
            return { path: 'a.md', name: 'a.md', content: '# A\n', sha: 'blob1', commit_sha: 'tip1' };
          case 'github_branches_exist':
            return args.branches;
          case 'github_open_pulls_for_branches':
            return (args.branches as string[]).map((branch) => ({ branch, pull: null }));
          case 'github_compare':
            return { ahead_by: 2, behind_by: 0, truncated: false, files: [{ filename: 'docs/a-rather-long-file-name.md', previous_filename: null, status: 'modified', additions: 3, deletions: 1 }] };
          case 'github_create_pull':
            return { number: 12, html_url: 'https://github.com/octo/notes/pull/12', label_warning: 'GitHub returned 403' };
          case 'recent_documents_list':
            return [];
          default:
            return null;
        }
      },
    };
  });
}

/** Every button, link, select, input and textarea inside `scope` is at least 44x44 CSS px. */
async function expectTapTargets(scope: Locator) {
  const small = await scope.locator('button, a[href], select, input, textarea').evaluateAll((els) =>
    els
      .map((el) => ({ el: el.outerHTML.slice(0, 90), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${el} ${r.width}x${r.height}`),
  );
  expect(small).toEqual([]);
}
const noSidewaysScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

test('review, details and result screens keep every tap target at 44x44 or more', async ({ page }) => {
  await stubBackend(page);
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'Open Repo…' }).click();
  await page.getByRole('button', { name: /octo\/notes/ }).click();
  await page.getByRole('button', { name: 'a.md' }).click();
  await expect(page.getByRole('switch', { name: 'Raw Markdown' })).toBeVisible();
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'Open PR…' }).click();

  const main = page.locator('main');
  await page.getByRole('option', { name: 'main' }).click();
  await page.getByRole('option', { name: 'release/a-rather-long-branch-name-for-the-wrapping' }).click();
  await expect(page.getByText('2 commits ahead, 0 commits behind release/a-rather-long-branch-name-for-the-wrapping')).toBeVisible();
  await expectTapTargets(page.locator('header'));
  await expectTapTargets(main);
  await noSidewaysScroll(page);

  await page.getByRole('button', { name: 'Open PR' }).click();
  await expect(page.getByRole('textbox', { name: 'Title' })).toHaveValue('main');
  await expectTapTargets(main);
  await noSidewaysScroll(page);

  await page.getByRole('button', { name: 'Open PR' }).click();
  await expect(page.getByRole('heading', { name: 'Pull request opened' })).toBeVisible();
  await expect(page.getByRole('note')).toContainText('Pull request created, but its label could not be added: GitHub returned 403');
  await expectTapTargets(page.locator('header'));
  await expectTapTargets(main);
  await noSidewaysScroll(page);
});
