import { expect, test, type Page } from '@playwright/test';

// The mobile tab strip, Outline drawer and unsaved-changes sheet on the Pixel 7 profile against /mobile/: 44x44 bounding boxes of tabs, close controls and "+", the scroll cue, the active tab scrolled into view, the sheet strings, and no horizontal page overflow.

async function newDocument(page: Page) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByRole('tablist', { name: 'Open documents' })).toBeVisible();
}

const sizes = (loc: ReturnType<Page['locator']>) =>
  loc.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));

async function manyTabs(page: Page, n: number) {
  await newDocument(page);
  for (let i = 1; i < n; i++) await page.getByRole('button', { name: 'New tab' }).click();
  await expect(page.getByRole('tab')).toHaveCount(n);
}

test('tabs, their close controls and "+" are at least 44x44, and the page never overflows sideways', async ({ page }) => {
  await manyTabs(page, 6);
  const tabs = await sizes(page.getByRole('tab'));
  const closes = await sizes(page.getByRole('button', { name: /^Close Untitled/ }));
  const plus = await sizes(page.getByRole('button', { name: 'New tab' }));
  expect(tabs).toHaveLength(6);
  expect(closes).toHaveLength(6);
  expect(plus).toHaveLength(1);
  for (const b of [...tabs, ...closes, ...plus]) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});

test('the strip scrolls sideways with a visible cue and the active tab is scrolled into view', async ({ page }) => {
  await manyTabs(page, 8);
  const strip = page.getByRole('tablist', { name: 'Open documents' });
  expect(await strip.evaluate((el) => el.scrollWidth > el.clientWidth)).toBe(true);
  // The cue: the edge fades are painted by the strip's own gradients, and "+" stays visible beside the strip.
  expect(await strip.evaluate((el) => getComputedStyle(el).backgroundImage.includes('linear-gradient'))).toBe(true);
  await expect(page.getByRole('button', { name: 'New tab' })).toBeInViewport();
  const inView = async (name: RegExp) =>
    page.getByRole('tab', { name }).evaluate((el) => {
      const s = el.closest('[role=tablist]')!.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      return r.left >= s.left - 1 && r.right <= s.right + 1;
    });
  // The newest tab (just added, selected) is in view although the strip is wider than the screen.
  expect(await inView(/Untitled 8/)).toBe(true);
  expect(await strip.evaluate((el) => el.scrollLeft)).toBeGreaterThan(0);
  // Selecting the first tab scrolls back to it.
  await strip.evaluate((el) => (el.scrollLeft = el.scrollWidth));
  await page.getByRole('tab', { name: /^Untitled\.md/ }).dispatchEvent('click');
  await expect.poll(() => inView(/^Untitled\.md/)).toBe(true);
});

test('closing a dirty tab asks with the exact sheet; Cancel keeps the tab', async ({ page }) => {
  await newDocument(page);
  await page.locator('.cm-content').click();
  await page.keyboard.type('hello');
  await expect(page.getByRole('tab').getByTitle('Unsaved changes')).toHaveText('●');
  await page.getByRole('button', { name: 'Close Untitled.md' }).click();
  const sheet = page.getByRole('dialog', { name: 'Save changes to Untitled.md?' });
  await expect(sheet).toBeVisible();
  await expect(sheet).toContainText('Your changes will be lost if you don’t save them.');
  await expect(sheet.getByRole('button', { name: 'Save', exact: true })).toBeFocused();
  for (const b of await sizes(sheet.getByRole('button'))) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
  }
  await sheet.getByRole('button', { name: 'Cancel' }).click();
  await expect(sheet).toBeHidden();
  await expect(page.getByRole('tab')).toHaveCount(1);
});

test('the Outline button opens a drawer that lists headings and jumps to one', async ({ page }) => {
  await newDocument(page);
  await page.locator('.cm-content').click();
  await page.keyboard.type('# Top');
  await page.keyboard.press('Enter');
  await page.keyboard.type('## Next');
  const button = page.getByRole('button', { name: 'Document outline' });
  expect((await sizes(button))[0].w).toBeGreaterThanOrEqual(44);
  await button.click();
  const drawer = page.getByRole('dialog', { name: 'Outline' });
  await expect(drawer.getByRole('listitem')).toHaveText(['Top', 'Next']);
  await drawer.getByRole('button', { name: 'Next' }).click();
  await expect(drawer).toBeHidden();
});
