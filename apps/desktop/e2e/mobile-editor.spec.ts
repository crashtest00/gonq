import { expect, test, type Page } from '@playwright/test';

/** Flips Raw Markdown through the ☰ menu (View) (the top-bar switch is gone). */
async function toggleRaw(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByRole('menuitem', { name: 'View' }).tap();
  await page.getByRole('menuitemcheckbox', { name: 'Raw Markdown' }).tap();
}

// The mobile editor screen on the Pixel 7 profile against /mobile/: typing, bold from the accessory bar, the Raw switch, and the 44px hit areas.

async function newDocument(page: Page) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
}

const size = (loc: ReturnType<Page['locator']>) =>
  loc.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));

test('types, bolds through the accessory bar and keeps focus in the editor', async ({ page }) => {
  await newDocument(page);
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.type('hello');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Bold' }).dispatchEvent('pointerdown');
  await page.getByRole('button', { name: 'Bold' }).click();
  await expect(content).toContainText('hello');
  await expect(page.locator('.cm-content :is(strong, .cm-strong, [class*=bold])').first()).toBeVisible();
  await expect(content).toBeFocused();
});

test('Raw switch shows the markers and back', async ({ page }) => {
  await newDocument(page);
  const content = page.locator('.cm-content');
  await content.click();
  await page.keyboard.type('hello');
  await page.keyboard.press('Shift+Home');
  await page.getByRole('button', { name: 'Bold' }).click();
  await toggleRaw(page);
  await expect(content).toContainText('**hello**');
  await toggleRaw(page);
  await expect(content).toContainText('hello');
});

test('accessory bar buttons are at least 44x44 and the bar never clips the page', async ({ page }) => {
  await newDocument(page);
  const buttons = await size(page.getByRole('toolbar', { name: 'Editing' }).getByRole('button'));
  expect(buttons).toHaveLength(12);
  const save = await size(page.getByRole('toolbar', { name: 'Editing' }).getByRole('button', { name: 'Save' }));
  expect(save).toHaveLength(1);
  expect(save[0].w).toBeGreaterThanOrEqual(44);
  expect(save[0].h).toBeGreaterThanOrEqual(44);
  for (const b of buttons) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
  const bar = page.getByRole('toolbar', { name: 'Editing' });
  const box = await bar.boundingBox();
  const viewport = page.viewportSize()!;
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height);
  expect(await bar.evaluate((el) => el.scrollWidth >= el.clientWidth)).toBe(true);
});
