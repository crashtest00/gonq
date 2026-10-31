import { expect, test, type Page } from '@playwright/test';

// The mobile repo picker, repo tree and branch sheet on the Pixel profile (project `mobile`): every interactive
// element has a hit area of at least 44x44 CSS px. The web build has no backend, so a stub Tauri invoke answers
// the three GitHub commands (list repos, list folder, list branches) the screens use.

async function stubBackend(page: Page) {
  await page.addInitScript(() => {
    const w = window as unknown as Record<string, unknown>;
    w.isTauri = true;
    const repos = Array.from({ length: 8 }, (_, i) => ({
      owner: 'octo',
      name: `repo-${i}`,
      full_name: `octo/repo-${i}`,
      private: i % 2 === 0,
      default_branch: 'main',
      can_push: i % 3 !== 0,
      pushed_at: null,
    }));
    const file = (path: string) => ({ name: path, path, kind: 'file' });
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      transformCallback: () => 0,
      invoke: async (cmd: string) => {
        switch (cmd.replace('plugin:gonq|', '')) {
          case 'github_status':
            return { signed_in: true, login: 'octo', storage: 'keychain' };
          case 'github_list_repos':
            return { repos, next_page: null };
          case 'github_list_folder':
            return {
              entries: [{ name: 'a-very-long-document-name-that-needs-to-scroll-sideways-on-a-phone-screen.md', path: 'long.md', kind: 'file' }, { name: 'docs', path: 'docs', kind: 'folder' }, file('a.md')],
              truncated: true,
            };
          case 'github_list_branches':
            return { default_branch: 'main', branches: ['main', 'dev', 'hotfix'], next_page: null };
          case 'recent_documents_list':
            return [];
          default:
            return null;
        }
      },
    };
  });
}

const smallBoxes = (page: Page) =>
  page
    .locator('button, a[href], input, select, textarea, [role=button], [role=option], [tabindex]:not([tabindex="-1"])')
    .evaluateAll((els) =>
      els
        .map((el) => ({ el: el.outerHTML.slice(0, 90), r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0)
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ el, r }) => `${el} ${r.width}x${r.height}`),
    );

test('picker, repo tree and branch sheet keep every tap target at 44x44 or more', async ({ page }) => {
  await stubBackend(page);
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'Open Repo…' }).click();
  await expect(page.getByRole('heading', { name: 'Open repository' })).toBeVisible();
  await expect(page.getByText('octo/repo-0')).toBeVisible();
  expect(await smallBoxes(page)).toEqual([]);

  await page.getByRole('button', { name: /octo\/repo-1/ }).click();
  await expect(page.getByRole('heading', { name: 'octo/repo-1' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'a.md' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Refresh' })).toBeEnabled();
  expect(await smallBoxes(page)).toEqual([]);
  // A long file name scrolls sideways inside the tree instead of widening the page.
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Branch: main' }).click();
  await expect(page.getByRole('option', { name: /hotfix/ })).toBeVisible();
  expect(await smallBoxes(page)).toEqual([]);
});
