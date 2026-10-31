import { expect, test, type Page } from '@playwright/test';

// The mobile long-press editor sheet and the ⋯ overflow menu on the Pixel 7 profile against /mobile/: a real held touch
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

test('a long press on the text opens the Editor sheet with the desktop items; every row is at least 44x44', async ({ page }) => {
  await editor(page);
  const box = (await page.locator('.cm-line').first().boundingBox())!;
  await hold(page, box.x + 20, box.y + box.height / 2, 800);
  const sheet = page.getByRole('dialog', { name: 'Editor' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('menuitem')).toHaveText(['Add Comment', 'Cut', 'Copy', 'Paste', 'Select All', 'Bold', 'Italic']);
  await expect(sheet.getByRole('menuitem', { name: /Insert link/ })).toHaveCount(0);
  for (const b of await sizes(sheet.getByRole('menuitem'))) {
    expect(b.w, b.n ?? '').toBeGreaterThanOrEqual(44);
    expect(b.h, b.n ?? '').toBeGreaterThanOrEqual(44);
  }
  await sheet.getByRole('menuitem', { name: 'Select All' }).tap();
  await expect(sheet).toHaveCount(0);
});

test('a short touch does not open the sheet', async ({ page }) => {
  await editor(page);
  const box = (await page.locator('.cm-line').first().boundingBox())!;
  await hold(page, box.x + 20, box.y + box.height / 2, 100);
  await expect(page.getByRole('dialog', { name: 'Editor' })).toHaveCount(0);
});

test('the ⋯ menu scrolls, lists every menu, and every row is at least 44x44', async ({ page }) => {
  await editor(page);
  await page.getByRole('button', { name: 'More' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Menu' });
  await expect(sheet).toBeVisible();
  await expect(sheet.getByRole('menu')).toHaveCount(6);
  await expect(sheet.getByRole('menuitem', { name: /Connect to Server/ })).toHaveCount(0);
  const rows = await sizes(sheet.locator('[data-command]'));
  expect(rows.length).toBeGreaterThan(30);
  for (const b of rows) {
    expect(b.w, b.n ?? '').toBeGreaterThanOrEqual(44);
    expect(b.h, b.n ?? '').toBeGreaterThanOrEqual(44);
  }
  // The sheet stays inside the screen and scrolls to the last menu.
  const vp = page.viewportSize()!;
  const sb = (await sheet.boundingBox())!;
  expect(sb.y + sb.height).toBeLessThanOrEqual(vp.height);
  await sheet.getByRole('menuitem', { name: 'About Gonq' }).scrollIntoViewIfNeeded();
  await expect(sheet.getByRole('menuitem', { name: 'About Gonq' })).toBeInViewport();
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('Theme radio rows apply Dark from the ⋯ menu', async ({ page }) => {
  await editor(page);
  await page.getByRole('button', { name: 'More' }).tap();
  await page.getByRole('menuitemradio', { name: 'Dark' }).tap();
  await expect(page.locator('html')).toHaveClass(/dark/);
});
