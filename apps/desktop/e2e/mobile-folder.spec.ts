import { expect, test, type Page } from '@playwright/test';

// The mobile local-folder flow on the Pixel profile (project `mobile`): Open Folder…, the Folder navigator sheet and the
// Save as name prompt keep every tap target at 44x44 or more and clip nothing, and in the plain browser (no Android plugin)
// Open Folder… shows the platform error in the banner and stays enabled. A stub Tauri invoke plays the `gonq-saf` plugin.

const TREE = 'content://com.android.externalstorage.documents/tree/primary%3ADocuments%2Fnotes';

async function stubAndroid(page: Page) {
  await page.addInitScript((tree) => {
    const w = window as unknown as Record<string, unknown>;
    w.isTauri = true;
    const rows: Record<string, { name: string; isDir: boolean }[]> = {
      '': [
        { name: 'meetings', isDir: true },
        { name: 'a-very-long-document-name-that-needs-to-scroll-sideways-on-a-phone-screen.md', isDir: false },
        { name: 'todo.md', isDir: false },
      ],
      meetings: [{ name: 'sync.md', isDir: false }],
    };
    w.__TAURI_INTERNALS__ = {
      metadata: { currentWindow: { label: 'main' }, currentWebview: { label: 'main', windowLabel: 'main' } },
      transformCallback: () => 0,
      invoke: async (cmd: string, args?: { rel?: string }) => {
        switch (cmd.replace('plugin:gonq-saf|', '').replace('plugin:gonq|', '')) {
          case 'local_pick_folder':
            return { picked: true, tree, name: 'notes' };
          case 'local_granted':
            return { trees: [tree] };
          case 'local_stat':
            return { size: 4, modified: 1_700_000_000_000, isDir: true };
          case 'local_list':
            return { entries: rows[args?.rel ?? ''] ?? [] };
          case 'local_read':
            return { bytes: btoa('# hi'), size: 4, modified: 1_700_000_000_000 };
          case 'github_status':
            return { signed_in: false, login: null, storage: 'keychain' };
          case 'recent_documents_list':
            return [];
          default:
            return null;
        }
      },
    };
  }, TREE);
}

const smallBoxes = (page: Page) =>
  page
    .locator('button, a[href], input, select, textarea, [role=button], [tabindex]:not([tabindex="-1"])')
    .evaluateAll((els) =>
      els
        .map((el) => ({ el: el.outerHTML.slice(0, 90), r: el.getBoundingClientRect() }))
        .filter(({ r }) => r.width > 0 && r.height > 0)
        .filter(({ r }) => r.width < 44 || r.height < 44)
        .map(({ el, r }) => `${el} ${r.width}x${r.height}`),
    );

test('the folder navigator sheet, its rows and Refresh are all at least 44x44 and fit the screen', async ({ page }) => {
  await stubAndroid(page);
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'Open Folder…' }).click();
  const sheet = page.getByRole('dialog', { name: 'Folder navigator' });
  await expect(sheet.getByText('Project folder')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'todo.md' })).toBeVisible();
  await sheet.getByRole('button', { name: /meetings/ }).click();
  await expect(sheet.getByRole('button', { name: 'sync.md' })).toBeVisible();
  expect(await smallBoxes(page)).toEqual([]);
  // The long name scrolls sideways inside the Files group instead of clipping silently.
  const files = sheet.getByRole('group', { name: 'Files' });
  expect(await files.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  const box = await sheet.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width + 1);
  // A file opens in the editor and the tab keeps a 44px hit area.
  await sheet.getByRole('button', { name: 'todo.md' }).click();
  await expect(page.getByRole('tab', { name: /todo\.md/ })).toBeVisible();
  expect(await smallBoxes(page)).toEqual([]);
});

test('with nothing open the sheet offers a disabled Refresh and Open Folder… at 44x44', async ({ page }) => {
  await stubAndroid(page);
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'Folder navigator' }).click();
  const sheet = page.getByRole('dialog', { name: 'Folder navigator' });
  await expect(sheet.getByText('No folder open')).toBeVisible();
  await expect(sheet.getByRole('button', { name: 'Refresh' })).toBeDisabled();
  expect(await smallBoxes(page)).toEqual([]);
});

test('in the plain browser Open Folder… stays enabled and shows the platform error in the banner', async ({ page }) => {
  await page.goto('/mobile/');
  const open = page.getByRole('button', { name: 'Open Folder…' });
  await expect(open).toBeEnabled();
  await open.click();
  await expect(page.getByRole('alert')).toContainText('Folders on this device can only be opened in the Gonq app for Android.');
  await expect(open).toBeEnabled();
});
