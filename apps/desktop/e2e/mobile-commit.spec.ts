import { expect, test, type Locator, type Page } from '@playwright/test';

// The mobile commit sheet, the conflict sheet and the read-only banner on the Pixel profile (project `mobile`): every
// button and link in them has a hit area of at least 44x44 CSS px, and the page does not scroll sideways. A stub Tauri
// invoke answers the GitHub commands; `pull` decides whether the branch has an open pull request, `conflict` the commit.

async function stubBackend(page: Page, opts: { pull: boolean; conflict?: boolean }) {
  await page.addInitScript((o) => {
    const w = window as unknown as Record<string, unknown>;
    w.isTauri = true;
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      transformCallback: () => 0,
      invoke: async (cmd: string) => {
        switch (cmd.replace('plugin:gonq|', '')) {
          case 'github_status':
            return { signed_in: true, login: 'octo', storage: 'keychain' };
          case 'github_list_repos':
            return { repos: [{ owner: 'octo', name: 'notes', full_name: 'octo/notes', private: false, default_branch: 'main', can_push: true, pushed_at: null }], next_page: null };
          case 'github_list_folder':
            return { entries: [{ name: 'a.md', path: 'a.md', kind: 'file' }], truncated: false };
          case 'github_list_branches':
            return { default_branch: 'main', branches: ['main'], next_page: null };
          case 'github_read_file':
            return { path: 'a.md', name: 'a.md', content: '# A\n', sha: 'blob1', commit_sha: 'tip1' };
          case 'github_open_pulls_for_branches':
            return [{ branch: 'main', pull: o.pull ? { number: 7, html_url: 'https://github.com/octo/notes/pull/7', draft: false, title: null } : null }];
          case 'github_commit_file':
            return o.conflict ? { status: 'conflict' } : { status: 'committed', sha: 'blob2', commit_sha: 'tip2' };
          case 'recent_documents_list':
            return [];
          default:
            return null;
        }
      },
    };
  }, opts);
}

async function openFile(page: Page) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'Open Repo…' }).click();
  await page.getByRole('button', { name: /octo\/notes/ }).click();
  await page.getByRole('button', { name: 'a.md' }).click();
  await expect(page.getByRole('switch', { name: 'Raw Markdown' })).toBeVisible();
}

/** Every button and link inside `scope` is at least 44x44 CSS px. */
async function expectTapTargets(scope: Locator) {
  const small = await scope.locator('button, a[href]').evaluateAll((els) =>
    els
      .map((el) => ({ el: el.outerHTML.slice(0, 90), r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44))
      .map(({ el, r }) => `${el} ${r.width}x${r.height}`),
  );
  expect(small).toEqual([]);
}

test('commit sheet and conflict sheet keep every tap target at 44x44 or more', async ({ page }) => {
  await stubBackend(page, { pull: false, conflict: true });
  await openFile(page);
  await page.locator('.cm-content').click();
  await page.keyboard.type('!');
  await page.getByRole('button', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: /^Save(?! As)/ }).click();
  const sheet = page.getByRole('dialog', { name: 'Commit a.md?' });
  await expect(sheet.getByRole('note')).toContainText('This commits directly to main.');
  await expect(sheet.getByRole('button', { name: 'Commit to new branch…' })).toBeVisible();
  await expectTapTargets(sheet);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await sheet.getByRole('button', { name: 'Commit', exact: true }).click();
  const conflict = page.getByRole('dialog', { name: 'a.md changed on the server since you opened it.' });
  await expect(conflict).toBeVisible();
  await expectTapTargets(conflict);
});

test('read-only banner and its Open PR link keep a 44x44 hit area', async ({ page }) => {
  await stubBackend(page, { pull: true });
  await openFile(page);
  const banner = page.getByTestId('read-only-banner');
  await expect(banner).toContainText('Pull request #7 is open for this branch. You can read this document but not change it.');
  await expect(banner.getByRole('link', { name: 'Open PR' })).toBeVisible();
  await expectTapTargets(banner);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
