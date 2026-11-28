import { expect, test, type Page } from '@playwright/test';

/** Flips Raw Markdown through the ☰ menu (View) (the top-bar switch is gone). */
async function toggleRaw(page: Page) {
  await page.getByRole('button', { name: 'Menu' }).tap();
  await page.getByRole('menuitem', { name: 'View' }).tap();
  await page.getByRole('menuitemcheckbox', { name: 'Raw Markdown' }).tap();
}

// The Add Comment bar on the Pixel 7 profile against /mobile/: hidden with a caret, slides in above the accessory bar for a selection, hides when it collapses, and a tap starts the draft. No emulator: the OS long-press handles are not exercised, the selection is a DOM range the editor reports.

const DOC = 'The estimate holds through Q3 but not beyond.\n';

async function newDocument(page: Page) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  await toggleRaw(page);
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(DOC);
  await toggleRaw(page);
}

const select = (page: Page, word: string | null) =>
  page.locator('.cm-content').evaluate((el, w) => {
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!;
    const i = w === null ? 3 : text.textContent!.indexOf(w);
    const range = document.createRange();
    range.setStart(text, i);
    range.setEnd(text, i + (w?.length ?? 0));
    sel.addRange(range);
  }, word);

test('Add Comment bar shows for a selection above the accessory bar, hides on collapse, tap opens the draft', async ({ page }) => {
  await newDocument(page);
  const bar = page.locator('.m-addcomment');
  const btn = page.getByRole('button', { name: 'Add Comment' });
  await expect(bar).toHaveAttribute('data-visible', 'false');
  await expect(btn).toBeHidden();
  await select(page, 'holds');
  await expect(btn).toBeVisible();
  await expect(bar).toHaveCSS('height', '44px');
  const b = (await btn.boundingBox())!;
  const t = (await page.getByRole('toolbar', { name: 'Editing' }).boundingBox())!;
  expect(b.height).toBeGreaterThanOrEqual(44);
  expect(b.y + b.height).toBeLessThanOrEqual(t.y + 2);
  await select(page, null);
  await expect(btn).toBeHidden();
  await select(page, 'holds');
  await btn.tap();
  const sheet = page.getByRole('dialog', { name: 'Comments' });
  await expect(sheet.getByText('New comment')).toBeVisible();
  await expect(sheet.getByRole('textbox', { name: 'Comment' })).toBeVisible();
});
