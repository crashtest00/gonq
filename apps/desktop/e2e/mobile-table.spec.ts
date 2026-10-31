import { expect, test, type Page } from '@playwright/test';

// Mobile touch table editing on the Pixel 7 profile against /mobile/: Table button, table bar swap, add a row by tap, 44x44 hit areas, release on outside tap.

async function tableDocument(page: Page) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await page.locator('.cm-content').click();
  await page.getByRole('button', { name: 'Insert table' }).click();
  await expect(page.locator('.cm-content td').first()).toBeVisible();
  await page.locator('.cm-content td').first().tap();
}

const size = (loc: ReturnType<Page['locator']>) =>
  loc.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));

test('Table button swaps to the table bar; Insert row below adds a row by tap', async ({ page }) => {
  await tableDocument(page);
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toBeVisible();
  const rows = await page.locator('.cm-content tr').count();
  await page.getByRole('button', { name: 'Table', exact: true }).tap();
  await expect(page.getByRole('toolbar', { name: 'Table' })).toBeVisible();
  await page.getByRole('button', { name: 'Insert row below' }).tap();
  await expect(page.locator('.cm-content tr')).toHaveCount(rows + 1);
  await page.getByRole('button', { name: 'Formatting toolbar' }).tap();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
});

test('table bar buttons are at least 44x44 and the bar never clips the page', async ({ page }) => {
  await tableDocument(page);
  await page.getByRole('button', { name: 'Table', exact: true }).tap();
  const bar = page.getByRole('toolbar', { name: 'Table' });
  const buttons = await size(bar.getByRole('button'));
  expect(buttons).toHaveLength(11);
  for (const b of buttons) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const box = (await bar.boundingBox())!;
  expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width);
  expect(box.y + box.height).toBeLessThanOrEqual(page.viewportSize()!.height);
});

test('tapping outside the table releases it and the formatting bar returns', async ({ page }) => {
  await tableDocument(page);
  await page.getByRole('button', { name: 'Table', exact: true }).tap();
  await page.getByRole('banner').getByRole('heading').tap();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Table', exact: true })).toHaveCount(0);
});
