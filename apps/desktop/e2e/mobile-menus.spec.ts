import { expect, test, type Page } from '@playwright/test';

// The mobile long press (left to the OS, no Editor sheet) and the ☰ menu drawer on the Pixel 7 profile against /mobile/: a real held touch
// (CDP touch events), the registry-generated menus, and the hit area of every row.

async function editor(page: Page) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await page.locator('.cm-content').click();
  await page.keyboard.type('hello world');
}

/** Holds one finger on (x, y) for `ms` and lifts it. */
async function hold(page: Page, x: number, y: number, ms: number) {
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
}

const sizes = (loc: ReturnType<Page['locator']>) =>
  loc.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { n: el.textContent, w: r.width, h: r.height }; }));

test('a long press on the text leaves selection to the OS: no Editor sheet opens', async ({ page }) => {
  await editor(page);
  const box = (await page.locator('.cm-line').first().boundingBox())!;
  await hold(page, box.x + 20, box.y + box.height / 2, 800);
  await expect(page.getByRole('dialog', { name: 'Editor' })).toHaveCount(0);
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
});

test('a short touch does not open the sheet', async ({ page }) => {
  await editor(page);
  const box = (await page.locator('.cm-line').first().boundingBox())!;
  await hold(page, box.x + 20, box.y + box.height / 2, 100);
  await expect(page.getByRole('dialog', { name: 'Editor' })).toHaveCount(0);
});

test('the ☰ drawer lists every menu and each level has rows of at least 44x44', async ({ page }) => {
  await editor(page);
  await page.getByRole('button', { name: 'Menu' }).tap();
  const drawer = page.getByRole('dialog', { name: 'Menu' });
  await expect(drawer).toBeVisible();
  await expect(drawer.getByRole('menuitem')).toHaveText(['File›', 'GitHub›', 'Edit›', 'View›', 'Insert›', 'Format›', 'Help›']);
  for (const b of await sizes(drawer.getByRole('button'))) {
    expect(b.w, b.n ?? '').toBeGreaterThanOrEqual(44);
    expect(b.h, b.n ?? '').toBeGreaterThanOrEqual(44);
  }
  await drawer.getByRole('menuitem', { name: 'File' }).tap();
  await expect(drawer.getByRole('menuitem', { name: /Connect to Server|Close Tab/ })).toHaveCount(0);
  const rows = await sizes(drawer.locator('[data-command]'));
  expect(rows.length).toBeGreaterThan(3);
  for (const b of rows) {
    expect(b.w, b.n ?? '').toBeGreaterThanOrEqual(44);
    expect(b.h, b.n ?? '').toBeGreaterThanOrEqual(44);
  }
  const vp = page.viewportSize()!;
  const sb = (await drawer.boundingBox())!;
  expect(sb.y + sb.height).toBeLessThanOrEqual(vp.height);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('Theme radio rows apply Dark from the ☰ menu (View > Theme)', async ({ page }) => {
  await editor(page);
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByRole('menuitem', { name: 'View' }).tap();
  await page.getByRole('menuitem', { name: 'Theme' }).tap();
  await page.getByRole('menuitemradio', { name: 'Dark' }).tap();
  await expect(page.locator('html')).toHaveClass(/dark/);
});
