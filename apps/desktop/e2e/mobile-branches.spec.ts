import { expect, test, type Page } from '@playwright/test';

// The mobile Create branch sheet on the Pixel profile (project `mobile`): the repo tree's action row (branch, Refresh,
// Create branch) fits the phone width, and the sheet, with its reason line and Cancel/Create buttons, keeps every
// interactive element at 44x44 CSS px or more. A stub Tauri invoke answers the GitHub commands.

async function stubBackend(page: Page) {
  await page.addInitScript(() => {
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
            return { default_branch: 'main', branches: ['main', 'dev'], next_page: null };
          case 'github_branch_exists':
            return false;
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

test('repo tree actions and the Create branch sheet keep every tap target at 44x44 or more', async ({ page }) => {
  await stubBackend(page);
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'Open Repo…' }).click();
  await page.getByRole('button', { name: /octo\/notes/ }).click();
  await expect(page.getByRole('button', { name: 'a.md' })).toBeVisible();
  expect(await smallBoxes(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);

  await page.getByRole('button', { name: 'Create branch' }).click();
  const sheet = page.getByRole('dialog', { name: 'Create branch' });
  await expect(sheet.getByTestId('branch-prefix')).toHaveText('gonq/');
  await sheet.getByRole('textbox', { name: 'Branch name' }).fill('a b');
  await expect(sheet.getByText('No spaces')).toBeVisible();
  expect(await smallBoxes(page)).toEqual([]);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
