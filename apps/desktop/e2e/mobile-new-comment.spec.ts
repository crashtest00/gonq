import { expect, test, type Page } from '@playwright/test';

// New comment, edit and delete by touch on the Pixel 7 profile against /mobile/: the draft box in the Comments sheet, Edit thread / Delete thread, and 44x44 tap targets on every control.

const DOC = 'The estimate holds through Q3 but not beyond.\n';

const boxes = (loc: ReturnType<Page['locator']>) =>
  loc.evaluateAll((els) => els.map((el) => { const r = el.getBoundingClientRect(); return { w: r.width, h: r.height }; }));

async function expectTargets(loc: ReturnType<Page['locator']>) {
  for (const b of await boxes(loc)) {
    expect(b.w).toBeGreaterThanOrEqual(44);
    expect(b.h).toBeGreaterThanOrEqual(44);
  }
}

async function newDocument(page: Page) {
  await page.goto('/mobile/');
  await page.getByRole('button', { name: 'New' }).click();
  await expect(page.getByRole('toolbar', { name: 'Editing' })).toBeVisible();
  const sw = page.getByRole('switch', { name: 'Raw Markdown' });
  await sw.getByText('Raw', { exact: true }).click();
  await page.locator('.cm-content').click();
  await page.keyboard.insertText(DOC);
  await sw.getByText('Formatted').click();
}

test('Add comment, edit and delete by touch; every control is at least 44x44', async ({ page }) => {
  await newDocument(page);
  // A real DOM selection of "holds"; the editor reports it as its selection.
  await page.locator('.cm-content').evaluate((el) => {
    const range = document.createRange();
    const text = document.createTreeWalker(el, NodeFilter.SHOW_TEXT).nextNode()!;
    const i = text.textContent!.indexOf('holds');
    range.setStart(text, i);
    range.setEnd(text, i + 5);
    const sel = window.getSelection()!;
    sel.removeAllRanges();
    sel.addRange(range);
  });
  await page.getByRole('button', { name: 'Comments' }).tap();
  const sheet = page.getByRole('dialog', { name: 'Comments' });
  await expectTargets(sheet.getByRole('button'));
  await sheet.getByRole('button', { name: 'Add comment' }).tap();
  await expect(sheet.getByText('New comment')).toBeVisible();
  const box = sheet.getByRole('textbox', { name: 'Comment' });
  await expect(box).toHaveAttribute('placeholder', 'Write a comment…');
  expect((await boxes(box))[0].h).toBeGreaterThanOrEqual(44);
  await expectTargets(sheet.getByRole('button'));
  await box.fill('Where does this come from?');
  await sheet.getByRole('button', { name: 'Submit' }).tap();
  await expect(sheet.getByText('Where does this come from?')).toBeVisible();
  await expect(page.locator('.cm-thread-marker')).toHaveCount(1);
  await expectTargets(sheet.getByRole('button'));

  await sheet.getByRole('button', { name: 'Edit thread' }).tap();
  const edit = sheet.getByRole('textbox', { name: 'Edit comment' });
  expect((await boxes(edit))[0].h).toBeGreaterThanOrEqual(44);
  await expectTargets(sheet.getByRole('button'));
  await edit.fill('Reworded');
  await sheet.getByRole('button', { name: 'Save' }).tap();
  await expect(sheet.getByText('Reworded')).toBeVisible();

  await sheet.getByRole('button', { name: 'Delete thread' }).tap();
  const ask = page.getByRole('alertdialog');
  await expect(ask.getByText('The whole thread, including its replies, is removed from the document.')).toBeVisible();
  await expectTargets(ask.getByRole('button'));
  await ask.getByRole('button', { name: 'Delete' }).tap();
  await expect(sheet.getByText('No comments yet.')).toBeVisible();
  await expect(page.locator('.cm-thread-marker')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(0);
});
